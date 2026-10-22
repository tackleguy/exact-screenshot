import { redirect } from "next/navigation";

/** The activity log lives on the profile page in the server-rendered app. */
export default function ActivityPage() {
  redirect("/you");
}
