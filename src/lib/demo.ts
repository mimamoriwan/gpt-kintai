import type { DemoRecordMetadata, UserProfile } from "../types";

export function isDemoRecord(value: DemoRecordMetadata | null | undefined): boolean {
  return value?.isDemo === true;
}

export function recordIsVisibleInDemoScope<T extends DemoRecordMetadata>(
  value: T,
  profile: UserProfile,
  showDemo: boolean
): boolean {
  if (profile.isDemo) {
    return value.isDemo === true && (!profile.demoDatasetId || value.demoDatasetId === profile.demoDatasetId);
  }
  return showDemo ? value.isDemo === true : value.isDemo !== true;
}

export function filterDemoScope<T extends DemoRecordMetadata>(rows: T[], profile: UserProfile, showDemo: boolean): T[] {
  return rows.filter((row) => recordIsVisibleInDemoScope(row, profile, showDemo));
}
