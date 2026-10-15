// GridCraft (github.com/storytold/gridcraft) — a Rust/wasm spreadsheet, served
// as a static site under /gridcraft/ by scripts/fetch-gridcraft.sh. Dev channel
// only: the tab is a `preview` one, and production builds don't fetch the app.
//
// An iframe rather than a bundle import: the app is a full egui canvas that
// sizes itself to its frame and keeps its own state, so the frame is the whole
// integration surface.
export default function Gridcraft() {
  return (
    <div className="gc">
      <iframe
        src="/gridcraft/"
        title="GridCraft — tableur"
        allow="fullscreen; clipboard-read; clipboard-write"
        allowFullScreen
      />
    </div>
  );
}
