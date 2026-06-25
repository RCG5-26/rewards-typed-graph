/** Shared input guards for plan routes (fixture + future live backend). */
export const MAX_PLAN_QUERY_LENGTH = 2000;
export const MAX_SELECTED_CARD_IDS = 20;

export function planQueryError(queryText: string): string | null {
  if (!queryText) return "A goal is required.";
  if (queryText.length > MAX_PLAN_QUERY_LENGTH) {
    return `Goal must be at most ${MAX_PLAN_QUERY_LENGTH} characters.`;
  }
  return null;
}

export function selectedCardIdsError(selectedCardIds: string[]): string | null {
  if (selectedCardIds.length > MAX_SELECTED_CARD_IDS) {
    return `At most ${MAX_SELECTED_CARD_IDS} cards can be selected.`;
  }
  return null;
}
