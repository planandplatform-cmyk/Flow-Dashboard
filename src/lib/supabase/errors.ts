/**
 * Database errors in plain English. The one admins hit is a missing
 * migration: a new channel or breakdown the database does not know yet.
 * The message names the exact line to run in the Supabase SQL Editor.
 */
export function friendlyDbError(message: string): string {
  const m = /invalid input value for enum (?:public\.)?(\w+): "([^"]+)"/i.exec(message);
  if (m) {
    return `The database needs a quick update before "${m[2]}" can be saved. In Supabase, open SQL Editor and run: alter type public.${m[1]} add value if not exists '${m[2]}'; Then save again.`;
  }
  return message;
}
