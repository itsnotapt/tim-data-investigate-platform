export const TAG_DIALOG_MESSAGES = {
  customised: 'Tag events successfully customised.',
  removed: 'Tag events successfully removed.',
  failed: (m: string) => `Customisation of tag events failed: ${m}`,
} as const;
