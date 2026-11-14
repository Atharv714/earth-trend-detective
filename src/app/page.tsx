import { Suspense } from "react";
import Workspace from "@/components/Workspace";

// The URL (?place=delhi&layer=rainfall) is read inside the boundary,
// so the rest of the page can still be prerendered.
export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<div className="globe-loading">Loading Earth</div>}>
      <Workspace searchParams={searchParams} />
    </Suspense>
  );
}
