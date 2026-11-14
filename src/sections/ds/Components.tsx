import { useState } from 'react';
import {
  Alert, Badge, Button, Card, Compass, Confidence, Gauge, IconButton, Input, Kbd, Legend, LogLine, Metric, Modal, Panel,
  Progress, Segmented, Select, Slider, Sparkline, StatusPill, Table, Tabs, Timeline, Toggle, Tooltip, UnitChip,
  color, type Tone, type TableColumn,
} from '@ds';
import { GroupTitle, Spec, SubSection } from './Spec';

const tones: Tone[] = ['neutral', 'signal', 'danger', 'warning', 'nominal', 'telemetry', 'detection'];

interface UnitRow {
  id: string;
  callsign: string;
  kind: 'drone' | 'engine' | 'crew' | 'helo' | 'tanker' | 'dozer';
  status: 'active' | 'enroute' | 'standby' | 'rtb';
  task: string;
  eta: string;
  fuel: number;
}

const units: UnitRow[] = [
  { id: 'u1', callsign: 'UAS-07 Kestrel', kind: 'drone', status: 'active', task: 'IR sweep / div A', eta: 'on scene', fuel: 0.64 },
  { id: 'u2', callsign: 'E-41', kind: 'engine', status: 'enroute', task: 'Structure prot. / Ridge Rd', eta: '06:40', fuel: 0.88 },
  { id: 'u3', callsign: 'Crew 12 Hotshot', kind: 'crew', status: 'active', task: 'Handline / div B', eta: 'on scene', fuel: 0.71 },
  { id: 'u4', callsign: 'H-522', kind: 'helo', status: 'rtb', task: 'Bucket drop / refill', eta: '11:15', fuel: 0.22 },
  { id: 'u5', callsign: 'T-910 VLAT', kind: 'tanker', status: 'standby', task: 'Retardant line, pending', eta: '24:00', fuel: 1 },
  { id: 'u6', callsign: 'D-3', kind: 'dozer', status: 'enroute', task: 'Contingency line / N flank', eta: '18:20', fuel: 0.53 },
];

const statusTone = { active: 'nominal', enroute: 'telemetry', standby: 'neutral', rtb: 'warning' } as const;

const columns: TableColumn<UnitRow>[] = [
  { key: 'callsign', header: 'Unit', render: (r) => <span className="uppercase text-bone">{r.callsign}</span> },
  { key: 'status', header: 'Status', render: (r) => <Badge tone={statusTone[r.status]} dot>{r.status}</Badge> },
  { key: 'task', header: 'Assignment', render: (r) => <span className="font-sans text-xs">{r.task}</span> },
  { key: 'eta', header: 'ETA', align: 'right' },
  {
    key: 'fuel',
    header: 'Fuel',
    align: 'right',
    width: 120,
    render: (r) => (
      <span className="inline-flex items-center gap-2">
        <span className="relative inline-block h-1 w-12 bg-ink-700">
          <span className={r.fuel < 0.3 ? 'absolute inset-y-0 left-0 bg-amber' : 'absolute inset-y-0 left-0 bg-bone-dim'} style={{ width: `${r.fuel * 100}%` }} />
        </span>
        {Math.round(r.fuel * 100)}%
      </span>
    ),
  },
];

const spark = [12, 14, 13, 17, 21, 19, 24, 28, 27, 33, 38, 36, 41, 47];
const sparkDown = [40, 38, 39, 34, 31, 33, 28, 25, 26, 22, 19, 18, 15, 12];

export function ComponentsSpec() {
  const [toggles, setToggles] = useState({ ir: true, forecast: true, wind: false });
  const [slider, setSlider] = useState(60);
  const [opacity, setOpacity] = useState(0.7);
  const [call, setCall] = useState('UAS-07');
  const [model, setModel] = useState('spread-v3');
  const [tab, setTab] = useState('feeds');
  const [seg, setSeg] = useState('60');
  const [layer, setLayer] = useState('sat');
  const [alerts, setAlerts] = useState(['danger', 'warning', 'detection', 'telemetry', 'nominal', 'signal']);
  const [modal, setModal] = useState(false);
  const [sel, setSel] = useState('u1');
  const [heading, setHeading] = useState(274);
  const [chip, setChip] = useState('UAS-07');

  const alertCopy: Record<string, { title: string; body: string; t: string }> = {
    danger: { title: 'Spot fire across containment', body: 'IR hotspot 340 m beyond Ridge Rd line. Crew 12 within 600 m.', t: '14:32:08Z' },
    warning: { title: 'Wind shift forecast', body: 'NOAA HRRR: 274° to 310° at 18 kt within 40 min.', t: '14:29:51Z' },
    detection: { title: 'Human detected / sector 4', body: 'Thermal signature, single person, stationary 3 min. Confidence 0.86.', t: '14:27:12Z' },
    telemetry: { title: 'AI ingest complete', body: '4 videos, 12 images, 3 news reports re-scored. Fire path re-projected.', t: '14:25:00Z' },
    nominal: { title: 'Line held / div A', body: 'No spread past dozer line for 22 min.', t: '14:20:44Z' },
    signal: { title: 'Plan revision ready', body: 'Recommendation R-14: reposition E-41 to Ridge Rd structures.', t: '14:19:03Z' },
  };

  return (
    <SubSection
      id="system-components"
      index="04.7"
      kicker="Components"
      title="The working parts."
      lede="Every component in the library, in every variant and state. All of them are live: hover, focus, press, and type into them."
      aside={
        <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-micro uppercase text-bone-mute">
          Import <Kbd>@ds</Kbd>
        </div>
      }
    >
      <div className="flex flex-col gap-14">
        {/* Actions */}
        <div>
          <GroupTitle code="K.1">Actions</GroupTitle>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Spec code='<Button variant="primary" kbd="⏎" />' tag="Variants" className="md:col-span-2">
              <Button variant="primary" kbd="⏎">Approve plan</Button>
              <Button variant="secondary" icon="route">Reroute</Button>
              <Button variant="ghost" iconRight="chevron-right">Details</Button>
              <Button variant="danger" icon="alert">Abort drop</Button>
            </Spec>
            <Spec code='<Button size="sm|md|lg" />' tag="Sizes">
              <Button variant="primary" size="sm">Deploy</Button>
              <Button variant="primary" size="md">Deploy</Button>
              <Button variant="primary" size="lg">Deploy</Button>
            </Spec>
            <Spec code="<Button loading | disabled />" tag="States">
              <Button variant="primary" loading>Uplinking</Button>
              <Button variant="secondary" loading>Syncing</Button>
              <Button variant="primary" disabled>Locked</Button>
              <Button variant="secondary" disabled>Offline</Button>
            </Spec>
            <Spec code='<IconButton icon label active />' tag="Icon">
              <IconButton icon="layers" label="Layers" />
              <IconButton icon="target" label="Target" active />
              <IconButton icon="expand" label="Expand" variant="ghost" />
              <IconButton icon="play" label="Play" size="sm" />
              <IconButton icon="pause" label="Pause" size="sm" variant="ghost" />
              <IconButton icon="settings" label="Settings" disabled />
            </Spec>
            <Spec code="<Kbd>" tag="Shortcut">
              <span className="inline-flex items-center gap-1.5 fcc-micro">
                <Kbd>⌘</Kbd>
                <Kbd>K</Kbd> Command
              </span>
              <span className="inline-flex items-center gap-1.5 fcc-micro">
                <Kbd>L</Kbd> Layers
              </span>
              <span className="inline-flex items-center gap-1.5 fcc-micro">
                <Kbd>Space</Kbd> Pause sim
              </span>
            </Spec>
          </div>
        </div>

        {/* Status */}
        <div>
          <GroupTitle code="K.2">Status</GroupTitle>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Spec code='<Badge tone variant="soft|outline|solid" />' tag="Badge" className="md:col-span-2" bodyClassName="flex-col items-stretch">
              {(['soft', 'outline', 'solid'] as const).map((v) => (
                <div key={v} className="flex flex-wrap items-center gap-2">
                  <span className="w-14 fcc-micro">{v}</span>
                  {tones.map((t) => (
                    <Badge key={t} tone={t} variant={v} dot={v !== 'outline'}>
                      {t}
                    </Badge>
                  ))}
                </div>
              ))}
            </Spec>
            <Spec code='<StatusPill status live />' tag="Pill" className="md:col-span-2">
              <StatusPill status="nominal" live>Link nominal</StatusPill>
              <StatusPill status="warning">Degraded</StatusPill>
              <StatusPill status="danger" live>Critical</StatusPill>
              <StatusPill status="telemetry" live>Uplink / 42 ms</StatusPill>
              <StatusPill status="offline" />
            </Spec>
          </div>
        </div>

        {/* Inputs */}
        <div>
          <GroupTitle code="K.3">Inputs</GroupTitle>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Spec code="<Toggle checked onChange label />" tag="Switch" bodyClassName="flex-col items-start">
              <Toggle checked={toggles.ir} onChange={(v) => setToggles((s) => ({ ...s, ir: v }))} label="IR overlay" />
              <Toggle checked={toggles.forecast} onChange={(v) => setToggles((s) => ({ ...s, forecast: v }))} label="Forecast +60" />
              <Toggle checked={toggles.wind} onChange={(v) => setToggles((s) => ({ ...s, wind: v }))} label="Wind field" size="sm" />
              <Toggle checked={false} onChange={() => undefined} label="Radar (offline)" disabled />
            </Spec>
            <Spec code='<Slider min max step unit />' tag="Range" bodyClassName="flex-col items-stretch gap-6">
              <Slider label="Forecast horizon" value={slider} min={0} max={180} step={5} unit="min" onChange={setSlider} />
              <Slider label="Layer opacity" value={opacity} min={0} max={1} step={0.05} onChange={setOpacity} />
            </Spec>
            <Spec code='<Input label prefix suffix hint />' tag="Text" bodyClassName="flex-col items-stretch">
              <Input label="Callsign" value={call} onChange={(e) => setCall(e.target.value)} prefix="ID" hint="Unique within incident" />
              <Input label="Search" placeholder="Units, markers, feeds" prefix={<span className="text-bone-mute">/</span>} suffix={<Kbd>⌘K</Kbd>} />
            </Spec>
            <Spec code='<Select label options value />' tag="Select" bodyClassName="flex-col items-stretch">
              <Select
                label="Spread model"
                value={model}
                onChange={setModel}
                options={[
                  { value: 'spread-v3', label: 'Spread v3.2 / Rothermel' },
                  { value: 'farsite', label: 'FARSITE ensemble' },
                  { value: 'ml', label: 'FCC-ML nowcast' },
                ]}
              />
              <Input label="Disabled" value="Locked by IC" disabled readOnly />
            </Spec>
            <Spec code='<Tabs items value onChange />' tag="Tabs" bodyClassName="items-stretch flex-col">
              <Tabs
                value={tab}
                onChange={setTab}
                items={[
                  { id: 'feeds', label: 'Feeds', count: 14 },
                  { id: 'insights', label: 'Insights', count: 6 },
                  { id: 'plan', label: 'Plan' },
                ]}
              />
              <Tabs
                size="sm"
                value={tab}
                onChange={setTab}
                items={[
                  { id: 'feeds', label: 'Feeds' },
                  { id: 'insights', label: 'Insights' },
                  { id: 'plan', label: 'Plan' },
                ]}
              />
            </Spec>
            <Spec code='<Segmented options value />' tag="Segmented" bodyClassName="flex-col">
              <Segmented
                aria-label="Forecast horizon"
                value={seg}
                onChange={setSeg}
                options={[
                  { value: '30', label: '+30' },
                  { value: '60', label: '+60' },
                  { value: '120', label: '+120' },
                  { value: '240', label: '+240' },
                ]}
              />
              <Segmented
                size="sm"
                aria-label="Base layer"
                value={layer}
                onChange={setLayer}
                options={[
                  { value: 'sat', label: 'Sat' },
                  { value: 'terrain', label: 'Terrain' },
                  { value: 'fuel', label: 'Fuel' },
                ]}
              />
            </Spec>
          </div>
        </div>

        {/* Feedback */}
        <div>
          <GroupTitle code="K.4">Feedback & overlays</GroupTitle>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-2 md:col-span-2">
              {alerts.length === 0 ? (
                <div className="flex h-24 items-center justify-center border border-dashed border-line">
                  <Button
                    size="sm"
                    icon="plus"
                    onClick={() => setAlerts(['danger', 'warning', 'detection', 'telemetry', 'nominal', 'signal'])}
                  >
                    Restore alerts
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                  {alerts.map((t) => {
                    const a = alertCopy[t];
                    if (!a) return null;
                    return (
                      <Alert key={t} tone={t as Tone} title={a.title} timestamp={a.t} onClose={() => setAlerts((s) => s.filter((x) => x !== t))}>
                        {a.body}
                      </Alert>
                    );
                  })}
                </div>
              )}
              <code className="font-mono text-micro text-bone-dim">{'<Alert tone title timestamp onClose />'}</code>
            </div>
            <Spec code="<Modal open onClose title footer />" tag="Dialog">
              <Button variant="primary" icon="ai" onClick={() => setModal(true)}>
                Review AI proposal
              </Button>
            </Spec>
            <Spec code='<Tooltip content side />' tag="Tooltip">
              <Tooltip content="Re-project fire path" side="top">
                <IconButton icon="route" label="Re-project" />
              </Tooltip>
              <Tooltip content="Confidence 0.86 / thermal" side="bottom">
                <Badge tone="detection" dot>Human</Badge>
              </Tooltip>
              <Tooltip content="Wind 274° / 18 kt" side="right">
                <IconButton icon="wind" label="Wind" variant="ghost" />
              </Tooltip>
            </Spec>
          </div>
        </div>

        {/* Data */}
        <div>
          <GroupTitle code="K.5">Data</GroupTitle>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Spec code='<Metric size="lg" spark delta />' tag="Metric" bodyClassName="items-stretch justify-start" className="xl:col-span-2">
              <div className="grid w-full grid-cols-2 gap-6">
                <Metric label="Burned area" value="1,284" unit="ha" size="lg" tone="danger" delta={{ value: '+6.2%', trend: 'up', good: false }} spark={spark} />
                <Metric label="Containment" value="38" unit="%" size="lg" tone="nominal" delta={{ value: '+4 pts', trend: 'up', good: true }} spark={[...sparkDown].reverse()} sub="Target 60% by 18:00Z" />
              </div>
            </Spec>
            <Spec code='<Metric size="sm|md" />' tag="Compact" bodyClassName="flex-col items-stretch">
              <Metric label="Rate of spread" value="0.42" unit="m/s" size="md" tone="warning" />
              <Metric label="Units on scene" value="23" size="sm" sub="4 enroute" />
            </Spec>
            <Spec code='<Gauge value tone label />' tag="Gauge">
              <Gauge value={0.62} label="Drone bat." tone="telemetry" size={104} />
              <Gauge value={0.38} label="Contain." tone="nominal" size={104} />
            </Spec>
            <Spec code='<Sparkline data tone fill />' tag="Sparkline" bodyClassName="flex-col">
              <Sparkline data={spark} tone="signal" width={160} height={32} />
              <Sparkline data={sparkDown} tone="telemetry" width={160} height={32} fill />
              <Sparkline data={[3, 5, 4, 9, 7, 12, 8, 14, 11, 9, 13, 10]} tone="neutral" width={160} height={24} />
            </Spec>
            <Spec code='<Progress value segments label showValue />' tag="Progress" bodyClassName="flex-col items-stretch" className="xl:col-span-2">
              <Progress value={0.38} label="Containment" showValue tone="nominal" />
              <Progress value={0.72} label="Ingest queue" showValue segments={24} tone="telemetry" />
              <Progress value={0.18} label="Tanker fuel" showValue segments={12} tone="warning" />
            </Spec>
            <Spec code='<Confidence value segments />' tag="Confidence" bodyClassName="flex-col items-start">
              {[0.92, 0.64, 0.31].map((v) => (
                <div key={v} className="flex w-full items-center justify-between gap-4">
                  <span className="fcc-micro">{v >= 0.75 ? 'High' : v >= 0.5 ? 'Medium' : 'Low'}</span>
                  <Confidence value={v} />
                </div>
              ))}
            </Spec>
            <Spec code='<Compass heading label />' tag="Compass">
              <Compass heading={heading} label="Wind" />
              <div className="flex flex-col gap-1">
                <IconButton icon="chevron-left" label="Rotate left" size="sm" onClick={() => setHeading((h) => h - 30)} />
                <IconButton icon="chevron-right" label="Rotate right" size="sm" onClick={() => setHeading((h) => h + 30)} />
              </div>
            </Spec>
          </div>
          <div className="mt-3">
            <Panel index="T" title="Resource roster" meta={`${units.length} units / click a row`} brackets bodyClassName="p-0">
              <Table columns={columns} rows={units} rowKey={(r) => r.id} onRowClick={(r) => setSel(r.id)} selectedKey={sel} />
            </Panel>
            <code className="mt-2 block font-mono text-micro text-bone-dim">{'<Table columns rows rowKey onRowClick selectedKey />'}</code>
          </div>
        </div>

        {/* Narrative */}
        <div>
          <GroupTitle code="K.6">Narrative & domain</GroupTitle>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Panel index="01" title="Incident timeline" meta="Last 30 min" brackets>
              <Timeline
                items={[
                  { id: '1', time: '14:32Z', title: 'Spot fire across Ridge Rd', body: 'UAS-07 IR confirms 0.3 ha.', tone: 'danger' },
                  { id: '2', time: '14:29Z', title: 'Wind shift forecast', body: 'Re-projection triggered.', tone: 'warning' },
                  { id: '3', time: '14:27Z', title: 'Human detected, sector 4', tone: 'detection' },
                  { id: '4', time: '14:19Z', title: 'Plan revision R-14 proposed', tone: 'signal' },
                  { id: '5', time: '14:02Z', title: 'Shift change, div B' },
                ]}
              />
            </Panel>
            <Panel index="02" title="Agent log" meta={<span className="text-phosphor">Streaming</span>} brackets bodyClassName="px-3 py-2">
              <LogLine time="14:32:08" source="uas-07" tone="telemetry">IR frame 0418: hotspot 412°C at 34.1902N 118.2213W</LogLine>
              <LogLine time="14:32:09" source="agent" tone="signal">Flagged spot fire. Confidence 0.91. Notifying IC.</LogLine>
              <LogLine time="14:31:40" source="news" tone="neutral">KTLA: residents report smoke near Ridge Rd.</LogLine>
              <LogLine time="14:31:02" source="radio" tone="neutral">Div B: handline complete to drop point 7.</LogLine>
              <LogLine time="14:30:51" source="sensor" tone="warning">RAWS-3 gust 31 kt, RH 9%.</LogLine>
              <LogLine time="14:29:15" source="detect" tone="detection">Person, stationary, sector 4. Requesting visual.</LogLine>
            </Panel>
            <div className="flex flex-col gap-3">
              <Panel index="03" title="Units" meta="Select" dense>
                <div className="flex flex-col gap-1.5">
                  {[
                    { c: 'UAS-07', k: 'drone', s: 'active', m: '62% / 120m' },
                    { c: 'E-41', k: 'engine', s: 'enroute', m: 'ETA 06:40' },
                    { c: 'H-522', k: 'helo', s: 'rtb', m: 'Fuel 22%' },
                    { c: 'D-3', k: 'dozer', s: 'standby', m: 'N flank' },
                  ].map((u) => (
                    <UnitChip
                      key={u.c}
                      callsign={u.c}
                      kind={u.k as UnitRow['kind']}
                      status={u.s as UnitRow['status']}
                      meta={u.m}
                      selected={chip === u.c}
                      onClick={() => setChip(u.c)}
                    />
                  ))}
                </div>
              </Panel>
              <Panel index="04" title="Legend" dense>
                <Legend
                  direction="column"
                  items={[
                    { label: 'Active fire front', color: color.ember, shape: 'line' },
                    { label: 'Forecast +60 min', color: color.amber, shape: 'dash' },
                    { label: 'Burn scar', color: '#2A1610', shape: 'square' },
                    { label: 'High-fuel brush', color: color.amber, shape: 'hatch' },
                    { label: 'Human detection', color: color.violet, shape: 'dot' },
                    { label: 'Drone track', color: color.ice, shape: 'line' },
                  ]}
                />
              </Panel>
            </div>
            <div className="lg:col-span-3">
              <GroupTitle code="K.7">Card</GroupTitle>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Card>
                  <span className="fcc-micro">Static</span>
                  <p className="mt-2 text-sm text-bone">Hairline container. No interaction.</p>
                </Card>
                <Card interactive onClick={() => undefined}>
                  <span className="fcc-micro">Interactive</span>
                  <p className="mt-2 text-sm text-bone">Hover to lift the rule weight.</p>
                </Card>
                <Card selected onClick={() => undefined}>
                  <span className="fcc-micro text-signal">Selected</span>
                  <p className="mt-2 text-sm text-bone">Signal brackets mark the current focus.</p>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="AI proposal / R-14"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(false)}>
              Dismiss
            </Button>
            <Button variant="secondary" icon="eye" onClick={() => setModal(false)}>
              Preview on map
            </Button>
            <Button variant="primary" kbd="⏎" onClick={() => setModal(false)}>
              Approve
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-bone">Reposition E-41 from staging to Ridge Rd structures (6 homes) before the forecast wind shift.</p>
          <div className="grid grid-cols-3 gap-px border border-line bg-line">
            {[
              ['Time to impact', '38 min'],
              ['Structures', '06'],
              ['Travel', '06:40'],
            ].map(([k, v]) => (
              <div key={k} className="bg-ink-900 p-3">
                <span className="fcc-micro">{k}</span>
                <div className="mt-1 font-mono text-lg text-bone fcc-num">{v}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <span className="fcc-micro">Sources: UAS-07 IR, RAWS-3, HRRR, Div B radio</span>
            <Confidence value={0.84} />
          </div>
        </div>
      </Modal>
    </SubSection>
  );
}
