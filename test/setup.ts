// Registers @testing-library/jest-dom matchers (toBeInTheDocument, etc.) for
// the component render tests. Importing only extends `expect`, so it is safe
// under the default node environment too.
import "@testing-library/jest-dom/vitest";
