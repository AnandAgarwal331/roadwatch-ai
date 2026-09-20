// Ported from backend/app/services/assessment.py. One complaint, one pass:
//   image -> AI detection -> visual severity
//   location -> nearby facilities -> location risk
//            -> traffic snapshot  -> traffic factor
//            -> previous reports  -> history factor
//            -> weather (optional)-> escalation
//                                 -> PriorityService -> PriorityAssessment
//
// Each stage degrades independently - if the detector is down the report
// still lands and still gets scored on its location signals. See the Python
// docstring for the full rationale.
//
// Unlike the Python version (one SQLAlchemy session, one transaction), this
// only COMPUTES the outcome - the actual multi-table write happens in one
// atomic call to the `persist_assessment` RPC (see
// supabase/migrations/*_assessment_rpc.sql), since Supabase's REST layer
// can't span multiple calls in a single transaction the way a session can.

import type { SupabaseClient } from "@supabase/supabase-js";
import { settings } from "../_shared/config.ts";
import type { ComplaintStatus, DamageType } from "../_shared/enums.ts";
import type { ComplaintRow } from "../repositories/complaint.ts";
import { getAIProvider } from "../providers/ai/factory.ts";
import { getTrafficProvider } from "../providers/traffic/factory.ts";
import { getPlacesProvider } from "../providers/places/factory.ts";
import { getWeatherProvider } from "../providers/weather/factory.ts";
import type { AnalysisResult } from "../providers/ai/base.ts";
import type { NearbyPlaceResult } from "../providers/places/base.ts";
import { riskMultiplier } from "../providers/weather/base.ts";
import { ComplaintHistoryService, historyAsSignals } from "./history.ts";
import { locationRiskService } from "./location_risk.ts";
import { PriorityService, type PriorityInput, type PriorityWeights } from "./priority.ts";
import { severityService } from "./severity.ts";

export interface AssessmentInput {
  complaint: ComplaintRow;
  imageBytes?: Uint8Array;
  imageContentType?: string;
  imageId?: string;
  roadImportance?: number;
  now?: Date;
}

/** Everything computed for one complaint, ready to hand to persist_assessment. */
export interface AssessmentOutcome {
  damageType: DamageType;
  severityScore: number;
  ai: {
    ran: boolean;
    analysis: AnalysisResult | null;
    isConfident: boolean;
    severityExplanation: string | null;
    message: string | null;
  };
  nearbyPlaces: NearbyPlaceResult[];
  location: { score: number; nearestByType: Record<string, number>; placeCount: number; radiusMeters: number };
  traffic: { level: string; score: number; estimatedVehiclesPerHour: number | null; observedAt: string; provider: string };
  weather: { condition: string; rainfallMm24h: number; temperatureC: number | null; observedAt: string; provider: string; multiplier: number } | null;
  history: ReturnType<typeof historyAsSignals> & { score: number };
  priority: {
    totalScore: number;
    level: string;
    explanation: string;
    weights: PriorityWeights;
    signals: Record<string, unknown>;
    weatherMultiplier: number;
    engineVersion: string;
    severityFactor: number;
    trafficFactor: number;
    locationFactor: number;
    historyFactor: number;
    severityPoints: number;
    trafficPoints: number;
    locationPoints: number;
    historyPoints: number;
  };
  needsManualReview: boolean;
}

export async function assess(client: SupabaseClient, input: AssessmentInput): Promise<AssessmentOutcome> {
  const now = input.now ?? new Date();
  const { complaint } = input;

  const aiStage = await runAI(client, input.imageBytes, input.imageContentType);
  const severity = aiStage.analysis ? severityService.estimate(aiStage.analysis) : null;
  const severityScore = severity?.score ?? 0.0;

  let damageType: DamageType;
  if (aiStage.analysis && !aiStage.analysis.errorMessage && aiStage.analysis.damageType !== "UNKNOWN") {
    damageType = aiStage.analysis.damageType;
  } else if (complaint.reported_damage_type) {
    damageType = complaint.reported_damage_type as DamageType;
  } else {
    damageType = "UNKNOWN";
  }

  const placesProvider = getPlacesProvider(client);
  let nearbyPlaces: NearbyPlaceResult[] = [];
  try {
    nearbyPlaces = await placesProvider.findNearby(complaint.latitude, complaint.longitude, settings.NEARBY_RADIUS_METERS);
  } catch {
    nearbyPlaces = [];
  }
  const locationResult = locationRiskService.assess(nearbyPlaces, settings.NEARBY_RADIUS_METERS, input.roadImportance ?? 5.0);

  const trafficProvider = getTrafficProvider();
  const trafficReading = await trafficProvider.getTraffic(complaint.latitude, complaint.longitude, now);

  const historyService = new ComplaintHistoryService(client);
  const historyResult = await historyService.analyse(complaint.latitude, complaint.longitude, { excludeId: complaint.id, now });

  const weatherProvider = getWeatherProvider();
  let weatherReading: Awaited<ReturnType<NonNullable<typeof weatherProvider>["getWeather"]>> | null = null;
  let weatherMultiplier = 1.0;
  if (weatherProvider) {
    try {
      weatherReading = await weatherProvider.getWeather(complaint.latitude, complaint.longitude, now);
      weatherMultiplier = riskMultiplier(weatherReading, damageType);
    } catch {
      weatherReading = null;
      weatherMultiplier = 1.0;
    }
  }

  const severityNote = severity ? severity.explanation.split(". ")[0].replace("Visual severity estimate: ", "") : "no usable visual assessment";
  const trafficNote = `traffic on this stretch is ${trafficReading.level.replace(/_/g, " ").toLowerCase()}`;
  const locationNote = locationResult.explanation.replace(/\.$/, "");
  const historyNote = historyResult.explanation.replace(/\.$/, "");

  const priorityInput: PriorityInput = {
    severity: severityScore,
    traffic: trafficReading.score,
    location: locationResult.score,
    history: historyResult.score,
    severityNote,
    trafficNote,
    locationNote,
    historyNote,
    weatherMultiplier,
    signals: {
      notes: { severity: severityNote, traffic: trafficNote, location: locationNote, history: historyNote },
      severity: severity?.components ?? {},
      traffic: { level: trafficReading.level, vehicles_per_hour: trafficReading.estimatedVehiclesPerHour, provider: trafficReading.provider },
      location: { nearest_by_type: locationResult.nearestByType, place_count: locationResult.placeCount, radius_meters: settings.NEARBY_RADIUS_METERS },
      history: historyAsSignals(historyResult),
      ai: {
        confident: !aiStage.needsReview,
        confidence: aiStage.analysis ? Math.round(aiStage.analysis.confidence * 10000) / 10000 : 0.0,
        detections: aiStage.analysis?.detections.length ?? 0,
        damaged_area_ratio: aiStage.analysis ? Math.round(aiStage.analysis.damagedAreaRatio * 10000) / 10000 : 0.0,
      },
    },
  };

  const priorityResult = new PriorityService().calculate(priorityInput);
  const pointsOf = (key: string) => priorityResult.breakdown.find((b) => b.key === key)?.points ?? 0;
  const factorOf = (key: string) => priorityResult.breakdown.find((b) => b.key === key)?.value ?? 0;

  return {
    damageType,
    severityScore,
    ai: {
      ran: aiStage.analysis !== null,
      analysis: aiStage.analysis,
      isConfident: !aiStage.needsReview,
      severityExplanation: severity?.explanation ?? null,
      message: aiStage.message,
    },
    nearbyPlaces,
    location: { score: locationResult.score, nearestByType: locationResult.nearestByType, placeCount: locationResult.placeCount, radiusMeters: settings.NEARBY_RADIUS_METERS },
    traffic: {
      level: trafficReading.level,
      score: trafficReading.score,
      estimatedVehiclesPerHour: trafficReading.estimatedVehiclesPerHour,
      observedAt: trafficReading.observedAt.toISOString(),
      provider: trafficReading.provider,
    },
    weather: weatherReading
      ? {
          condition: weatherReading.condition,
          rainfallMm24h: weatherReading.rainfallMm24h,
          temperatureC: weatherReading.temperatureC,
          observedAt: weatherReading.observedAt.toISOString(),
          provider: weatherReading.provider,
          multiplier: weatherMultiplier,
        }
      : null,
    history: { ...historyAsSignals(historyResult), score: historyResult.score },
    priority: {
      totalScore: priorityResult.totalScore,
      level: priorityResult.level,
      explanation: priorityResult.explanation,
      weights: priorityResult.weights,
      signals: priorityResult.signals,
      weatherMultiplier: priorityResult.weatherMultiplier,
      engineVersion: priorityResult.engineVersion,
      severityFactor: factorOf("severity"),
      trafficFactor: factorOf("traffic"),
      locationFactor: factorOf("location"),
      historyFactor: factorOf("history"),
      severityPoints: pointsOf("severity"),
      trafficPoints: pointsOf("traffic"),
      locationPoints: pointsOf("location"),
      historyPoints: pointsOf("history"),
    },
    needsManualReview: aiStage.needsReview,
  };
}

async function runAI(
  client: SupabaseClient,
  imageBytes: Uint8Array | undefined,
  contentType: string | undefined,
): Promise<{ analysis: AnalysisResult | null; needsReview: boolean; message: string | null }> {
  if (!imageBytes) {
    return { analysis: null, needsReview: true, message: "No photo was provided, so no AI analysis was performed." };
  }

  const provider = getAIProvider();
  let result: AnalysisResult;
  try {
    result = await provider.analyze(imageBytes, contentType ?? "application/octet-stream");
  } catch {
    result = {
      damageType: "UNKNOWN",
      confidence: 0.0,
      detections: [],
      damagedAreaRatio: 0.0,
      modelName: "unknown",
      modelVersion: "0",
      provider: provider.name,
      processingMs: 0,
      errorMessage: "The AI service failed unexpectedly.",
    };
  }

  const confident = !result.errorMessage && result.confidence >= settings.AI_MIN_CONFIDENCE && result.damageType !== "UNKNOWN";

  let message: string | null = null;
  if (result.errorMessage) {
    message = "AI analysis is temporarily unavailable. Your report has been submitted and will be reviewed manually.";
  } else if (!confident) {
    message = "AI could not confidently identify the issue. Your report has been submitted for manual review.";
  }

  return { analysis: result, needsReview: !confident, message };
}
