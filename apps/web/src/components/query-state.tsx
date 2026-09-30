import { Button } from "@repo/ui";
export function QueryError({
  error,
  retry,
}: {
  error: Error;
  retry: () => void;
}) {
  return (
    <div className="feedback error" role="alert">
      <p>{error.message}</p>
      <Button variant="secondary" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}
export function Loading() {
  return <p role="status">Loading…</p>;
}
