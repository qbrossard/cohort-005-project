import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import { bookmarks, courses, lessons, modules, notes } from "~/db/schema";
import { MAX_NOTE_LENGTH } from "~/lib/notes";

// ─── Bookmarks and Notes ───
// What a Student attaches to a Lesson for themselves alone, and the Saved
// lists that gather them. See GLOSSARY.md for the language.
//
// A Note is private to the Student who wrote it: nothing here reads another
// Student's rows, and no Instructor or Platform Admin view may call these.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Content access is the caller's job (`requireContentAccess`).

export type Db = BetterSQLite3Database<typeof schema>;

type Note = typeof notes.$inferSelect;

function studentsBookmark(studentId: number, lessonId: number) {
  return and(eq(bookmarks.userId, studentId), eq(bookmarks.lessonId, lessonId));
}

function studentsNote(studentId: number, lessonId: number) {
  return and(eq(notes.userId, studentId), eq(notes.lessonId, lessonId));
}

export function isBookmarked(db: Db, studentId: number, lessonId: number) {
  return !!db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(studentsBookmark(studentId, lessonId))
    .get();
}

/**
 * Adds the Bookmark if the Lesson has none, removes it if it has one.
 * Returns whether the Lesson is now bookmarked.
 */
export function toggleBookmark(
  db: Db,
  studentId: number,
  lessonId: number,
  now: Date
): boolean {
  const removed = db
    .delete(bookmarks)
    .where(studentsBookmark(studentId, lessonId))
    .returning({ id: bookmarks.id })
    .all();
  if (removed.length > 0) return false;

  // The unique index keeps a racing second insert from adding a duplicate.
  db.insert(bookmarks)
    .values({ userId: studentId, lessonId, createdAt: now.toISOString() })
    .onConflictDoNothing()
    .run();
  return true;
}

export function getNote(db: Db, studentId: number, lessonId: number) {
  return db
    .select()
    .from(notes)
    .where(studentsNote(studentId, lessonId))
    .get();
}

export type SaveNoteResult = { ok: true; note: Note } | { ok: false; error: string };

/**
 * Creates the Student's Note on a Lesson, or replaces its body and moves
 * `updatedAt` on if one exists. `createdAt` is kept on a re-save.
 */
export function saveNote(
  db: Db,
  studentId: number,
  lessonId: number,
  body: string,
  now: Date
): SaveNoteResult {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Write something before saving your note." };
  }
  if (trimmed.length > MAX_NOTE_LENGTH) {
    return {
      ok: false,
      error: `A note must be ${MAX_NOTE_LENGTH.toLocaleString("en-US")} characters or fewer.`,
    };
  }

  const timestamp = now.toISOString();
  const note = db
    .insert(notes)
    .values({
      userId: studentId,
      lessonId,
      body: trimmed,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: [notes.userId, notes.lessonId],
      set: { body: trimmed, updatedAt: timestamp },
    })
    .returning()
    .get();

  return { ok: true, note };
}

const lessonRef = {
  lessonId: lessons.id,
  lessonTitle: lessons.title,
  moduleTitle: modules.title,
  courseTitle: courses.title,
  courseSlug: courses.slug,
};

/** The Student's Bookmarks, newest first, each with its Lesson and Course. */
export function listSavedBookmarks(db: Db, studentId: number) {
  return db
    .select({ id: bookmarks.id, createdAt: bookmarks.createdAt, ...lessonRef })
    .from(bookmarks)
    .innerJoin(lessons, eq(bookmarks.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(bookmarks.userId, studentId))
    .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id))
    .all();
}

/** The Student's Notes, last edited first, each with its Lesson and Course. */
export function listSavedNotes(db: Db, studentId: number) {
  return db
    .select({
      id: notes.id,
      body: notes.body,
      updatedAt: notes.updatedAt,
      ...lessonRef,
    })
    .from(notes)
    .innerJoin(lessons, eq(notes.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(notes.userId, studentId))
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .all();
}
