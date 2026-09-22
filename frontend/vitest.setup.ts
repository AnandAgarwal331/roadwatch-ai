import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// `server-only` throws when imported outside a React Server Component build,
// which is exactly what a unit test is. Server modules are tested directly.
vi.mock("server-only", () => ({}));
