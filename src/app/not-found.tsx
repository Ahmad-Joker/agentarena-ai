import Link from "next/link";
import { Button } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center text-center">
      <div>
        <p className="font-mono text-sm text-violet-soft">404</p>
        <h1 className="mt-2 text-2xl font-semibold">Nothing in this arena</h1>
        <p className="mt-2 text-sm text-ink-400">The page or benchmark you requested does not exist.</p>
        <Button asChild variant="secondary" className="mt-6">
          <Link href="/">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
