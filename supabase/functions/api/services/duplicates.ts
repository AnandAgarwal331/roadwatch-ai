// Ported from backend/app/services/duplicates.py. Four signals blended into
// a 0-1 similarity (distance/type/recency/image-hash); see the Python
// docstring for the full rationale. Detection only ever produces a
// *suggestion* for an admin to confirm or reject - nothing is auto-merged.
//
// Always called with the service client: recording a suggestion happens
// during report creation (a citizen action, but potential_duplicates is
// admin-only under RLS), and confirm/reject are themselves admin actions
// that also update complaints.status (also admin-only under RLS).

import type { SupabaseClient } from "@supabase/supabase-js";
import { settings } from "../_shared/config.ts";
import type { DamageType, DuplicateStatus, ComplaintStatus } from "../_shared/enums.ts";
import { findNearby, type ComplaintRow } from "../repositories/complaint.ts";
import { imageSimilarity } from "./images.ts";

// PostgREST needs the FK constraint name to disambiguate: potential_duplicates
// has two FKs to complaints (complaint_id and duplicate_complaint_id), so a
// bare `complaints(...)` embed would be ambiguous. Postgres's default naming
// (no explicit `constraint ... foreign key` in the migration) is
// `<table>_<column>_fkey`.
const DUPLICATE_LINK_SELECT =
  "*, complaint:complaints!potential_duplicates_complaint_id_fkey(complaint_number), " +
  "duplicate_complaint:complaints!potential_duplicates_duplicate_complaint_id_fkey(complaint_number)";

const SUGGESTION_THRESHOLD = 0.55;

const WEIGHT_DISTANCE = 0.45;
const WEIGHT_TYPE = 0.25;
const WEIGHT_RECENCY = 0.15;
const WEIGHT_IMAGE = 0.15;

const RELATED_TYPES: Partial<Record<DamageType, DamageType[]>> = {
  POTHOLE: ["CRACKED_ROAD", "DAMAGED_SIDEWALK"],
  CRACKED_ROAD: ["POTHOLE", "DAMAGED_SIDEWALK"],
  DAMAGED_SIDEWALK: ["CRACKED_ROAD", "POTHOLE"],
  FLOODING: ["POTHOLE"],
};

export interface DuplicateCandidate {
  complaint: ComplaintRow;
  similarity: number;
  distanceMeters: number;
  reason: string;
}

function typeScore(left: DamageType, right: DamageType): [number, string] {
  if (left === right) return [1.0, `both reported as ${left.replace(/_/g, " ").toLowerCase()}`];
  if (RELATED_TYPES[left]?.includes(right)) return [0.6, "closely related damage types"];
  return [0.15, "different damage types"];
}

function humaniseDays(days: number): string {
  if (days < 1) return "within the last day";
  if (days < 2) return "about a day apart";
  return `about ${Math.round(days)} days apart`;
}

function primaryHash(complaint: ComplaintRow, images: { kind: string; perceptual_hash: string | null }[]): string | null {
  for (const image of images) {
    if (image.kind === "REPORT" && image.perceptual_hash) return image.perceptual_hash;
  }
  return null;
}

export class DuplicateService {
  constructor(private client: SupabaseClient) {}

  async findCandidates(
    complaint: ComplaintRow,
    complaintImages: { kind: string; perceptual_hash: string | null }[],
    opts: { radiusMeters?: number; windowDays?: number; now?: Date } = {},
  ): Promise<DuplicateCandidate[]> {
    const radius = opts.radiusMeters ?? settings.DUPLICATE_RADIUS_METERS;
    const windowDays = opts.windowDays ?? settings.DUPLICATE_WINDOW_DAYS;
    const now = opts.now ?? new Date();

    const neighbours = await findNearby(this.client, complaint.latitude, complaint.longitude, radius, {
      excludeId: complaint.id,
      since: new Date(now.getTime() - windowDays * 86_400_000),
    });

    const candidateHash = primaryHash(complaint, complaintImages);
    const candidates: DuplicateCandidate[] = [];

    // One batch query for every neighbour's primary REPORT-photo hash,
    // rather than N+1 - mirrors what the Python session's relationship
    // eager-loading achieves implicitly.
    const neighbourIds = neighbours.map((n) => n.complaint.id);
    const hashByComplaintId = new Map<string, string>();
    if (neighbourIds.length > 0) {
      const { data: images, error: imagesErr } = await this.client
        .from("complaint_images")
        .select("complaint_id, kind, perceptual_hash")
        .in("complaint_id", neighbourIds)
        .eq("kind", "REPORT")
        .not("perceptual_hash", "is", null);
      if (imagesErr) throw imagesErr;
      for (const img of images ?? []) {
        if (!hashByComplaintId.has(img.complaint_id) && img.perceptual_hash) {
          hashByComplaintId.set(img.complaint_id, img.perceptual_hash);
        }
      }
    }

    for (const item of neighbours) {
      const other = item.complaint;
      if (other.duplicate_of_id === complaint.id || complaint.duplicate_of_id === other.id) continue;

      const otherHash = hashByComplaintId.get(other.id) ?? null;

      const [similarity, reason] = this.score(complaint, other, item.distanceMeters, radius, windowDays, candidateHash, otherHash, now);
      if (similarity >= SUGGESTION_THRESHOLD) {
        candidates.push({
          complaint: other,
          similarity: Math.round(similarity * 10000) / 10000,
          distanceMeters: item.distanceMeters,
          reason,
        });
      }
    }

    candidates.sort((a, b) => b.similarity - a.similarity);
    return candidates;
  }

  async recordCandidates(complaint: ComplaintRow, candidates: DuplicateCandidate[]): Promise<number> {
    let created = 0;
    for (const candidate of candidates) {
      const { data: existing } = await this.client
        .from("potential_duplicates")
        .select("id")
        .eq("complaint_id", complaint.id)
        .eq("duplicate_complaint_id", candidate.complaint.id)
        .maybeSingle();
      if (existing) continue;

      const { error } = await this.client.from("potential_duplicates").insert({
        complaint_id: complaint.id,
        duplicate_complaint_id: candidate.complaint.id,
        similarity_score: candidate.similarity,
        distance_meters: candidate.distanceMeters,
        reason: candidate.reason,
        status: "SUGGESTED" satisfies DuplicateStatus,
      });
      if (error) throw error;
      created++;
    }
    return created;
  }

  async getLink(linkId: string): Promise<Record<string, unknown> | null> {
    const { data, error } = await this.client.from("potential_duplicates").select("*").eq("id", linkId).maybeSingle();
    if (error) throw error;
    return data;
  }

  async listPending(limit = 100): Promise<Record<string, unknown>[]> {
    const { data, error } = await this.client
      .from("potential_duplicates")
      .select(DUPLICATE_LINK_SELECT)
      .eq("status", "SUGGESTED" satisfies DuplicateStatus)
      .order("similarity_score", { ascending: false })
      .limit(limit);
    if (error) throw error;
    // supabase-js's select-string type parser can't resolve the `!fkey`
    // disambiguation syntax statically (produces GenericStringError instead
    // of a real row type) - the runtime shape is correct regardless.
    return (data ?? []) as unknown as Record<string, unknown>[];
  }

  /** Links in either direction - duplication is symmetric. */
  async listForComplaint(complaintId: string): Promise<Record<string, unknown>[]> {
    const { data, error } = await this.client
      .from("potential_duplicates")
      .select(DUPLICATE_LINK_SELECT)
      .or(`complaint_id.eq.${complaintId},duplicate_complaint_id.eq.${complaintId}`)
      .order("similarity_score", { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as Record<string, unknown>[];
  }

  /**
   * Link a duplicate to its canonical complaint. The *older* report is
   * canonical (it holds the original history); the newer one is marked
   * DUPLICATE and pointed at it. The canonical's report_count grows.
   * Returns the updated canonical/duplicate rows so the caller (see
   * services/complaints.ts's confirmDuplicate) can record status history
   * and an audit entry against them, mirroring Python's
   * ComplaintService.confirm_duplicate/DuplicateService.confirm split.
   */
  async confirm(linkId: string, reviewerId: string | null, now?: Date): Promise<{ canonical: ComplaintRow; duplicate: ComplaintRow }> {
    const { data: link, error: linkErr } = await this.client
      .from("potential_duplicates")
      .select("*")
      .eq("id", linkId)
      .single();
    if (linkErr) throw linkErr;

    const { data: first } = await this.client.from("complaints").select("*").eq("id", link.complaint_id).single();
    const { data: second } = await this.client.from("complaints").select("*").eq("id", link.duplicate_complaint_id).single();
    if (!first || !second) throw new Error("One of the linked complaints no longer exists");

    const [canonicalBefore, duplicateBefore] = new Date(first.created_at) <= new Date(second.created_at) ? [first, second] : [second, first];

    const { data: duplicate, error: dupErr } = await this.client
      .from("complaints")
      .update({ duplicate_of_id: canonicalBefore.id, status: "DUPLICATE" satisfies ComplaintStatus })
      .eq("id", duplicateBefore.id)
      .select()
      .single();
    if (dupErr) throw dupErr;

    const { data: canonical, error: canonErr } = await this.client
      .from("complaints")
      .update({ report_count: (canonicalBefore.report_count ?? 1) + Math.max(1, duplicateBefore.report_count ?? 1) })
      .eq("id", canonicalBefore.id)
      .select()
      .single();
    if (canonErr) throw canonErr;

    const { error: linkUpdateErr } = await this.client
      .from("potential_duplicates")
      .update({ status: "CONFIRMED" satisfies DuplicateStatus, reviewed_by_id: reviewerId, reviewed_at: (now ?? new Date()).toISOString() })
      .eq("id", linkId);
    if (linkUpdateErr) throw linkUpdateErr;

    return { canonical, duplicate };
  }

  async reject(linkId: string, reviewerId: string | null, now?: Date): Promise<void> {
    const { error } = await this.client
      .from("potential_duplicates")
      .update({ status: "REJECTED" satisfies DuplicateStatus, reviewed_by_id: reviewerId, reviewed_at: (now ?? new Date()).toISOString() })
      .eq("id", linkId);
    if (error) throw error;
  }

  private score(
    complaint: ComplaintRow,
    other: ComplaintRow,
    distance: number,
    radius: number,
    windowDays: number,
    candidateHash: string | null,
    otherHash: string | null,
    now: Date,
  ): [number, string] {
    const reasons: string[] = [];

    const distanceScore = radius ? Math.max(0.0, 1.0 - distance / radius) : 0.0;
    reasons.push(`${distance.toFixed(0)}m apart`);

    const [typeScoreValue, typeReason] = typeScore(complaint.damage_type, other.damage_type);
    reasons.push(typeReason);

    const ageDays = Math.abs(now.getTime() - new Date(other.created_at).getTime()) / 86_400_000;
    const recencyScore = windowDays ? Math.max(0.0, 1.0 - ageDays / windowDays) : 0.0;
    reasons.push(`reported ${humaniseDays(ageDays)}`);

    const similarity = imageSimilarity(candidateHash, otherHash);

    let score: number;
    if (similarity === null) {
      const totalWeight = WEIGHT_DISTANCE + WEIGHT_TYPE + WEIGHT_RECENCY;
      score = (distanceScore * WEIGHT_DISTANCE + typeScoreValue * WEIGHT_TYPE + recencyScore * WEIGHT_RECENCY) / totalWeight;
    } else {
      score = distanceScore * WEIGHT_DISTANCE + typeScoreValue * WEIGHT_TYPE + recencyScore * WEIGHT_RECENCY + similarity * WEIGHT_IMAGE;
      if (similarity >= 0.85) reasons.push(`photos look ${(similarity * 100).toFixed(0)}% alike`);
    }

    return [score, "This may be the same road issue: " + reasons.join(", ") + "."];
  }
}
