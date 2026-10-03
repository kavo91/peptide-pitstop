/**
 * Shown when a save call THROWS instead of answering. In practice that is almost
 * always an expired session: the middleware redirects the server-action POST to
 * /login and Next's action client throws "An unexpected response was received
 * from the server." It cannot be told apart from a dropped connection, so the
 * message names both remedies and asks the user to check before retrying (the
 * save may have landed).
 */
export const SAVE_FAILED_MESSAGE =
  "Could not save. You may have been signed out — reload the page (sign in if asked), check whether it saved, then try again.";
