import { formatDistanceStrict } from "date-fns";
import { format } from "date-fns";

export function timeAgo(date: Date) {
  return formatDistanceStrict(new Date(date), new Date(), { addSuffix: true });
}

export function formattedDate(date: Date) {
  return format(date, "yyyy/MM/dd HH:mm");
}
