import { Brackets, Button, Dot, RegMark, Ruler, SectionHeader, Serial } from '@ds';
import { SimProvider } from '@/sim';
import Dashboard from '@/dashboard/Dashboard';

export default function DashboardSection() {
  return (
    <section id="dashboard" className="relative border-t border-line bg-ink-950 py-24 lg:py-30">
      <div className="mx-auto max-w-[1680px] px-4 sm:px-6 lg:px-10">
        <SectionHeader
          index="04"
          eyebrow="Live Operations · REV D"
          title={
            <>
              One map.
              <br />
              <span className="text-bone-mute">One Orchestrator.</span>
            </>
          }
          lede="Dozens of analysis agents read news, satellite passes, vehicle and drone cameras, social video, weather and terrain. The Orchestrator grades every finding from 0 to 100 and decides where it shows: life-safety interrupts the map, what needs you sits in the dock, and everything else waits quietly on the map or in the log."
          meta={<Serial>SIM · NOT LIVE DATA</Serial>}
        />

        <div className="relative mt-12 grid grid-cols-1 items-center gap-6 border border-line bg-ink-900 p-6 lg:mt-16 lg:grid-cols-[1fr_auto] lg:p-8">
          <Brackets size={10} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <Serial>REV D · FCC-OPS / CONSOLE 02</Serial>
              <span className="flex items-center gap-1.5 fcc-micro text-phosphor">
                <Dot className="bg-phosphor" live size={5} />
                Full-screen · 1920 × 1080+
              </span>
            </div>
            <h3 className="mt-4 text-2xl text-bone">Replay Mati 2018 or Caldor 2021.</h3>
            <p className="mt-2 max-w-3xl text-sm text-bone-dim">
              A 3D stage over public terrain and reconstructed fire history. Simulated agent pools read every feed, a prototype projection agent
              keeps re-forecasting, and the Orchestrator decides what you see and drafts the work: drone retasks, crew moves,
              evacuation notices, ICS-209 sitreps. A ledger estimates human-equivalent work, not measured time savings. Scenario built from public data;
              units, people and events are simulated.
            </p>
          </div>
          <Button variant="primary" size="lg" iconRight="arrow-right" onClick={() => window.location.assign('/console.html')}>
            Open the full console
          </Button>
        </div>

        <div className="relative mx-auto mt-16 max-w-[1600px] lg:mt-20">
          {/* Sheet registration */}
          <RegMark className="absolute -left-7 -top-7 hidden lg:block" />
          <RegMark className="absolute -right-7 -top-7 hidden lg:block" />
          <RegMark className="absolute -bottom-7 -left-7 hidden lg:block" />
          <RegMark className="absolute -bottom-7 -right-7 hidden lg:block" />

          {/* Bezel caption, top */}
          <div className="mb-2 flex items-center gap-3">
            <Serial>FCC-OPS / CONSOLE 01</Serial>
            <span className="hidden fcc-micro sm:inline">Concept preview · Rev B · Orchestrator-first · 2560×1440</span>
            <div className="hidden flex-1 md:block">
              <Ruler ticks={80} major={10} />
            </div>
            <span className="ml-auto flex items-center gap-1.5 fcc-micro text-phosphor md:ml-0">
              <span className="h-1.5 w-1.5 animate-blink bg-phosphor" />
              Live sim
            </span>
          </div>

          <div className="relative flex gap-2">
            <div className="hidden w-3 shrink-0 lg:block">
              <Ruler orientation="vertical" ticks={48} major={8} />
            </div>

            {/* Bezel */}
            <div className="relative min-w-0 flex-1 border border-line-strong bg-ink-900 p-1.5 shadow-lift sm:p-2">
              <Brackets size={14} tone="bone" inset={-5} />
              <div className="relative overflow-hidden border border-line bg-ink-950 lg:h-[min(920px,92vh)] lg:min-h-[760px]">
                <SimProvider>
                  <Dashboard />
                </SimProvider>
              </div>
            </div>

            <div className="hidden w-3 shrink-0 lg:block">
              <Ruler orientation="vertical" ticks={48} major={8} />
            </div>
          </div>

          {/* Bezel caption, bottom */}
          <div className="mt-2 flex items-center justify-between gap-4 fcc-micro">
            <span>Simulated environment · procedural terrain · not for operational use</span>
            <span className="hidden fcc-num md:inline">AO RIDGE · 9.6 × 6.0 KM · CELL 40 M</span>
          </div>
        </div>
      </div>
    </section>
  );
}
