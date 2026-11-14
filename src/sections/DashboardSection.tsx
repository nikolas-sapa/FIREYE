import { Brackets, RegMark, Ruler, SectionHeader, Serial } from '@ds';
import { SimProvider } from '@/sim';
import Dashboard from '@/dashboard/Dashboard';

export default function DashboardSection() {
  return (
    <section id="dashboard" className="relative border-t border-line bg-ink-950 py-24 lg:py-30">
      <div className="mx-auto max-w-[1680px] px-4 sm:px-6 lg:px-10">
        <SectionHeader
          index="04"
          eyebrow="Live Operations · REV B"
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

        <div className="relative mx-auto mt-12 max-w-[1600px] lg:mt-16">
          {/* Sheet registration */}
          <RegMark className="absolute -left-7 -top-7 hidden lg:block" />
          <RegMark className="absolute -right-7 -top-7 hidden lg:block" />
          <RegMark className="absolute -bottom-7 -left-7 hidden lg:block" />
          <RegMark className="absolute -bottom-7 -right-7 hidden lg:block" />

          {/* Bezel caption, top */}
          <div className="mb-2 flex items-center gap-3">
            <Serial>FCC-OPS / CONSOLE 01</Serial>
            <span className="hidden fcc-micro sm:inline">Rev B · Orchestrator-first · 2560×1440</span>
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
