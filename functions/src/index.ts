import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {defineSecret} from "firebase-functions/params";

/**
 * Slack Incoming Webhook URL stored as a Firebase Secret.
 */
const SLACK_WEBHOOK_URL = defineSecret("SLACK_WEBHOOK_URL");

/**
 * Default region for function execution.
 */
const REGION = "europe-central2";

/**
 * Pretty-print data for Slack, converting Firestore Timestamps to ISO strings.
 * @param {unknown} value - Any Firestore document field value.
 * @return {string} JSON string representation with ISO dates.
 */
function jsonForSlack(value: unknown): string {
  const replacer = (_key: string, v: unknown) => {
    if (
      v &&
      typeof v === "object" &&
      "toDate" in (v as Record<string, unknown>) &&
      typeof (v as {toDate: () => Date}).toDate === "function"
    ) {
      return (v as {toDate: () => Date}).toDate().toISOString();
    }
    if (v instanceof Date) return v.toISOString();
    return v;
  };
  return JSON.stringify(value, replacer, 2);
}

/**
 * Wraps text in a Slack code block, truncated to avoid block size limits.
 * @param {string} s - Text to wrap.
 * @param {number} [max=2900] - Maximum length allowed before truncation.
 * @return {string} Slack-formatted code block text.
 */
function codeBlockWithLimit(s: string, max = 2900): string {
  if (s.length <= max) return "```" + s + "```";
  return "```" + s.slice(0, max - 20) + "\n… (truncated)```";
}

/**
 * Firestore trigger: sends a Slack message when a new document is added
 * to the "messages" collection.
 */
export const notifySlackOnNewMessage = onDocumentCreated(
  {
    document: "messages/{docId}",
    region: REGION,
    secrets: [SLACK_WEBHOOK_URL],
  },
  async (event) => {
    const docId = event.params.docId;
    const data = event.data?.data();
    if (!data) return;

    const messageText =
      typeof data.message === "string" ?
        data.message :
        JSON.stringify(data.message ?? "", null, 2);
    const json = jsonForSlack(data);
    const payload = {
      text: `New Firestore message: ${docId}`,
      blocks: [
        {
          type: "header",
          text: {type: "plain_text", text: "New Firestore message"},
        },
        {
          type: "section",
          text: {
            type: "plain_text",
            text: messageText,
          },
        },
        {
          type: "section",
          fields: [
            {type: "mrkdwn", text: "*Collection:*\nmessages"},
            {type: "mrkdwn", text: `*Doc ID:*\n${docId}`},
          ],
        },
        {
          type: "section",
          text: {type: "mrkdwn", text: codeBlockWithLimit(json)},
        },
      ],
    };

    const res = await fetch(process.env.SLACK_WEBHOOK_URL as string, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Slack webhook failed: ${res.status} ${body}`);
    }
  },
);
