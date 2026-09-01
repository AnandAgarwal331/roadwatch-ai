import type { Metadata } from "next";

import { TaskDetail } from "@/features/team/task-detail";

export const metadata: Metadata = {
  title: "Job detail",
};

export default async function TeamTaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TaskDetail assignmentId={id} />;
}
