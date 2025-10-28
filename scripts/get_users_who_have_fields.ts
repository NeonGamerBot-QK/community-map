import "dotenv/config";
import { WebClient } from "@slack/web-api";
import fs from "fs";
import path from "path";

const token = process.env.SLACK_BOT_TOKEN;
if (!token) {
  throw new Error("SLACK_BOT_TOKEN is not defined in environment variables.");
}
let total_user_count = 0;

const web = new WebClient(token);

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 10): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      if (
        error.data?.error === "ratelimited" ||
        error.code === "rate_limited"
      ) {
        const retryAfter = error.data?.retry_after || Math.pow(2, i);
        console.log(
          `Rate limited. Retrying after ${retryAfter}s (attempt ${i + 1}/${maxRetries})`,
        );
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 3000));
      } else {
        throw error;
      }
    }
  }
  throw new Error("Max retries exceeded");
}
// web.users.profile
//   .get({
//     user: `U07UKLZT9N1`,
//     include_labels: true,
//   })
//   .then((d) =>
//     console.log({
//       location_field: d.profile?.fields!["Xf01S5PAG9HQ"]?.value,
//       school_field: d.profile?.fields!["Xf01S5PAG9HQ"]?.value,
//       phone: d.profile?.phone,
//     }),
//   );
const users = [];
let cursor: string | undefined = "dXNlcjpVMDFHQ1FRM01ORw==";
do {
  const res = await withRetry(() =>
    web.users.list({
      limit: 200,
      cursor: cursor,
      include_locale: true,
    }),
  );
  if (!res.members) {
    break;
  }
  for (const member of res.members) {
    total_user_count++;
    if (member.is_bot || member.deleted) {
      continue;
    }
    const profile = await withRetry(() =>
      web.users.profile.get({
        user: member.id!,
        include_labels: true,
      }),
    ).then((d) => d.profile);
    if (profile && profile.fields) {
      //@ts-ignore
      const location_field = profile.fields!["Xf01S5PAG9HQ"]?.value;
      //@ts-ignore
      const school_field = profile.fields!["Xf01S5PAG9HQ"]?.value;
      console.log({ location_field, school_field, f: profile.fields });
      if (location_field || school_field) {
        users.push({
          id: member.id,
          name: member.name,
          real_name: member.real_name,
          location_field,
          school_field,
          phone: profile.phone,
          locale: member.locale,
        });
        // write to file
        fs.writeFileSync(
          path.join(__dirname, `./users_with_fields.json`),
          JSON.stringify(users, null, 2),
        );
        await new Promise((resolve) => setTimeout(resolve, 2000)); // sleep for 1000ms to avoid rate limits
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500)); // sleep for 200ms to avoid rate limits
  }
  await new Promise((resolve) => setTimeout(resolve, 200)); // sleep for 200ms to avoid rate limits
  cursor = res.response_metadata?.next_cursor;
  console.log(
    `Processed ${total_user_count} users, found ${users.length} users with fields so far. cursor: ${cursor}`,
  );
} while (cursor);

console.log(
  `Finished processing. Total users processed: ${total_user_count}. Users with fields: ${users.length}.`,
);
