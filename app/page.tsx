// tr1via.com root.
//
// The root URL redirects to the public marketing page (/trivia-night) — the
// indexable "what is TR1VIA" home for discovery traffic. Players who were told
// "go to tr1via.com" land on marketing and tap "Got a code? Join a game" to
// reach code entry at /join. QR deep-links (/join?code=XXX) bypass this
// entirely, so the scan-to-join path is untouched.
//
// Temporary (307) redirect on purpose: keeps the apex flexible if the product's
// front door changes again. The room-code form that used to live here now lives
// only at /join, which is already phone-native (PhoneScreen + scan-the-QR hint).
import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/trivia-night");
}
