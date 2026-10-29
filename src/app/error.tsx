"use client";

import { Button } from "@/components/ui/primitives";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="grid min-h-[60vh] place-items-center text-center">
      <div>
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 max-w-md text-sm text-ink-400">
          The server could not render this page. Check that Postgres is running (<code>npm run db:up</code>) and that the .env file is valid.
        </p>
        <Button onClick={reset} variant="secondary" className="mt-6">
          Try again
        </Button>
      </div>
    </div>
  );
}
