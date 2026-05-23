// Player surface root — there's no live page here; bounce to /join so the
// player either types/scans a room code or lands directly on a room.

import { redirect } from "next/navigation";

export default function PlayerIndexPage() {
  redirect("/join");
}
