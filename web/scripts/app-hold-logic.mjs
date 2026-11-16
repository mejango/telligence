// Held writes and saved-attempt recovery have one owner: the SDK (createHeldWriteView,
// followHeldWrite, createSavedAttemptRecovery and their copy). No app copy of the hold's send gate,
// exit, follower, recovery rule or lines may come back.
export const APP_HOLD_LOGIC = [
  [
    /\b(createHeldWriteView|followHeldWrite)\b/,
    "an app-made held-write view or follower (useHeldSend, useHeldWrite)",
  ],
  [
    /\bsendUnderHold\b/,
    "an app send-under-hold loop (send through the reviewed engine, which holds every write)",
  ],
  [/\btakeHeldExit\b/, "an app held-exit loop (the SDK view's exit)"],
  [/\bWENT_THROUGH\b|earlier transaction went through/, "the app's went-through gate"],
  [
    /(function|const)\s+(hidesShownExit|settledLine|offersExit|withNotice)\b/,
    "an app copy of an SDK hold helper",
  ],
  [
    /\b(recoverFromHold|holdOutcome|recoverSavedLaunch|recoverLaunch|releaseLaunch|discardUnreadableLaunch)\b/,
    "app saved-attempt recovery (createSavedAttemptRecovery)",
  ],
  [
    /\b(useWriteHoldWatch|UnreadableJournalExit|adoptIntoHold|holdsHash|holdUntilResolved|watchSafeProposal|refuseUnheldSafeDuplicate)\b/,
    "an app hold watcher, follower or adoption",
  ],
  [
    /\bJOURNAL_(UNREADABLE_LINE|UNREADABLE_WARNING|DISCARD_ACTION)\b/,
    "app copies of the SDK's unreadable-storage copy",
  ],
  [
    /nana-sdk:(reviewed-write|saved-attempt)/,
    "direct storage access to the SDK's hold or recovery keys",
  ],
  [
    /["'`](I checked my wallet|This browser can't read its saved transactions|Released\. You can send it again|Confirming your transaction\.|This went through while you were away|Executed by your Safe\. Confirming it onchain\.|Your transaction went through\.)/,
    "a literal copy of an SDK hold line or label (import the constant)",
  ],
];
