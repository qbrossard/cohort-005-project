// PROTOTYPE — throwaway. Answers "What does the Notification Feed look like in Cadence?"
// (https://github.com/qbrossard/cohort-005-project/issues/13). Not production code.
//
// Talks to the real vendor (Knock): signs the per-user token the browser needs to read
// its own feed, and triggers one generic workflow to drop catalogue Notifications in it.

import Knock, { signUserToken } from "@knocklabs/node";
import { eq, ne } from "drizzle-orm";
import { db } from "~/db";
import { users, courses, modules, lessons, UserRole } from "~/db/schema";

// One generic workflow for the prototype: an in-app feed step that passes the trigger
// data straight through. See .knock/workflows/cadence-notification.
export const PROTOTYPE_WORKFLOW_KEY = "cadence-notification";

export const NOTIFICATION_KINDS = [
  "refund_request_raised",
  "refund_request_approved",
  "refund_request_declined",
  "new_question",
  "new_reply",
  "new_enrollment",
  "seat_claimed",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface KnockFeedConfig {
  publicKey: string;
  feedChannelId: string;
  userId: string;
  userToken: string;
}

// Cadence user id -> Knock user id. User sync is still fog on the map; the prototype
// identifies users inline when it triggers.
function knockUserId(id: number) {
  return String(id);
}

export async function getKnockFeedConfig(
  userId: number | null
): Promise<KnockFeedConfig | null> {
  const publicKey = process.env.KNOCK_PUBLIC_API_KEY;
  const feedChannelId = process.env.KNOCK_FEED_CHANNEL_ID;
  if (!userId || !publicKey || !feedChannelId || !process.env.KNOCK_SIGNING_KEY)
    return null;

  return {
    publicKey,
    feedChannelId,
    userId: knockUserId(userId),
    // Signed for exactly this user: Knock refuses the feed of anyone else.
    userToken: await signUserToken(knockUserId(userId), {
      expiresInSeconds: 60 * 60,
    }),
  };
}

function inlineUser(u: typeof users.$inferSelect) {
  // Name and avatar only: the feed needs nothing else, so no email leaves Cadence here.
  return { id: knockUserId(u.id), name: u.name, avatar: u.avatarUrl ?? null };
}

function pick<T>(xs: T[]): T {
  return xs[Math.floor(Math.random() * xs.length)];
}

const QUESTIONS = [
  "Why does `unknown` need narrowing when `any` doesn't? I keep reaching for `any` to make the error go away.",
  "Is there a reason the example uses an interface here instead of a type alias?",
  "The video skips the part where the config file is created. Where should it live?",
];
const REPLIES = [
  "Good question. `unknown` forces you to prove the shape first, which is exactly the point.",
  "I hit the same thing. Restarting the TS server fixed it for me.",
  "It's covered two lessons later, but the short answer is: put it at the repo root.",
];
const DECLINE_NOTES = [
  "More than half of the course has been completed, so it falls outside the refund policy.",
  "The purchase is past the 30-day refund window.",
];

function buildNotification(kind: NotificationKind, recipientId: number) {
  const recipient = db.select().from(users).where(eq(users.id, recipientId)).get()!;
  const others = db.select().from(users).where(ne(users.id, recipientId)).all();
  const student = pick(others.filter((u) => u.role === UserRole.Student));
  const admin =
    others.find((u) => u.role === UserRole.Admin) ?? pick(others);

  const taught = db
    .select()
    .from(courses)
    .where(eq(courses.instructorId, recipientId))
    .all();
  const course = pick(taught.length ? taught : db.select().from(courses).all());
  const lesson = pick(
    db
      .select({ id: lessons.id, title: lessons.title })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .where(eq(modules.courseId, course.id))
      .all()
  );
  const lessonUrl = `/courses/${course.slug}/lessons/${lesson.id}`;
  const amount = pick(["$49.00", "$79.00", "$129.00"]);

  switch (kind) {
    case "refund_request_raised":
      return {
        actor: student,
        data: {
          text: `${student.name} asked for a refund on ${course.title} (${amount})`,
          url: "/admin/refunds",
        },
      };
    case "refund_request_approved":
      return {
        actor: admin,
        data: {
          text: `Your refund request for ${course.title} was approved. ${amount} is on its way back.`,
          url: `/courses/${course.slug}`,
        },
      };
    case "refund_request_declined":
      return {
        actor: admin,
        data: {
          text: `Your refund request for ${course.title} was declined. You can raise a new one.`,
          excerpt: pick(DECLINE_NOTES),
          url: `/courses/${course.slug}`,
        },
      };
    case "new_question":
      return {
        actor: student,
        data: {
          text: `${student.name} asked a question on ${lesson.title}`,
          excerpt: pick(QUESTIONS),
          url: lessonUrl,
        },
      };
    case "new_reply": {
      const replier = pick(others);
      return {
        actor: replier,
        data: {
          text: `${replier.name} replied to your comment on ${lesson.title}`,
          excerpt: pick(REPLIES),
          url: lessonUrl,
        },
      };
    }
    case "new_enrollment":
      return {
        actor: student,
        data: {
          text: `${student.name} enrolled on ${course.title}`,
          url: `/instructor/${course.id}/students`,
        },
      };
    case "seat_claimed": {
      const total = pick([5, 10, 25]);
      const claimed = 1 + Math.floor(Math.random() * total);
      return {
        actor: student,
        data: {
          text: `${student.name} claimed a Seat on ${course.title}. ${claimed} of ${total} claimed.`,
          url: "/team",
        },
      };
    }
  }
  void recipient;
}

// The Notifications a role would plausibly have waiting, per the catalogue.
const BURST_BY_ROLE: Record<string, NotificationKind[]> = {
  [UserRole.Admin]: [
    "refund_request_raised",
    "refund_request_raised",
    "new_reply",
    "refund_request_raised",
  ],
  [UserRole.Instructor]: [
    "new_question",
    "new_enrollment",
    "new_enrollment",
    "new_reply",
    "new_question",
    "new_enrollment",
  ],
  [UserRole.Student]: [
    "new_reply",
    "refund_request_declined",
    "new_reply",
    "refund_request_approved",
    "seat_claimed",
  ],
};

export async function sendPrototypeNotifications(
  recipientId: number,
  kind: NotificationKind | "burst"
) {
  const recipient = db.select().from(users).where(eq(users.id, recipientId)).get();
  if (!recipient) throw new Error("No such user");

  const kinds =
    kind === "burst" ? (BURST_BY_ROLE[recipient.role] ?? ["new_reply"]) : [kind];

  const knock = new Knock({ apiKey: process.env.KNOCK_API_KEY });
  for (const k of kinds) {
    const n = buildNotification(k, recipientId)!;
    await knock.workflows.trigger(PROTOTYPE_WORKFLOW_KEY, {
      recipients: [inlineUser(recipient)],
      actor: inlineUser(n.actor),
      // Flat on purpose: Knock's compact feed mode drops nested objects from `data`.
      data: { kind: k, ...n.data },
    });
  }
  return kinds.length;
}
