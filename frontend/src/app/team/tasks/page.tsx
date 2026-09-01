import type { Metadata } from "next";

import { TaskList } from "@/features/team/task-list";

export const metadata: Metadata = {
  title: "All jobs",
  description: "Every job assigned to your crew.",
};

export default function TeamTasksPage() {
  return <TaskList />;
}
