// Design-preview sample data for the /dev/host gallery pages ONLY.
//
// These values used to be built into the components as defaults, so the
// real setup screens showed them to the real host. The components now show
// nothing when a caller passes nothing; the dev galleries pass these
// explicitly so the design previews still look filled in.

import type { HostGenImageUploadProps, RecentTopic } from "@/components/host/gen";

export const DEMO_RECENT_TOPICS: RecentTopic[] = [
  { name: "Pixar Movies", date: "Apr 2", used: true },
  { name: "Geography", date: "last night" },
  { name: "NFL Teams", date: "May 12" },
  { name: "90s Music", date: "May 7" },
  { name: "Local Madison", date: "May 5" },
  { name: "Greek Mythology", date: "Apr 23" },
  { name: "World Cup", date: "Apr 16" },
  { name: "Cocktails", date: "Apr 9" },
  { name: "Beatles", date: "Mar 26" },
];

export const DEMO_RECENT_PHOTOS: NonNullable<HostGenImageUploadProps["recent"]> = [
  { id: "u1", seed: "linda1", name: "Paris · Eiffel night", used: 3, date: "Apr 9" },
  { id: "u2", seed: "linda2", name: "Café Hugo · table", used: 1, date: "Apr 9" },
  { id: "u3", seed: "linda3", name: "Soul Fire · sign", used: 12, date: "Feb 15" },
];

export const DEMO_UPLOAD_FILENAME = "paris-eiffel-2024.jpg";
export const DEMO_UPLOAD_PERCENT = 68;
export const DEMO_EDIT_EYEBROW = "EDIT QUESTION · 6 OF 20";
