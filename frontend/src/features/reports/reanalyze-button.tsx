"use client";

import { useMutation } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";

/**
 * Re-runs the AI/priority/location pipeline against this report's current
 * photo and coordinates - for when something that feeds the score (like
 * nearby-places data) was fixed after the report was first submitted, and
 * resubmitting from scratch would be overkill.
 */
export function ReanalyzeButton({ complaintId }: { complaintId: string }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();

  const mutation = useMutation({
    mutationFn: () => api.post(`/complaints/${complaintId}/analyze`),
    onSuccess: () => {
      success("Report re-analyzed", "Its score now reflects the latest data.");
      router.refresh();
    },
    onError: (error: unknown) => toastError("Could not re-analyze this report", errorMessage(error)),
  });

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
    >
      <RefreshCw aria-hidden="true" className={mutation.isPending ? "animate-spin" : undefined} />
      {mutation.isPending ? "Re-analyzing..." : "Re-analyze this report"}
    </Button>
  );
}
