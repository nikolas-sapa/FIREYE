import type { ActorContext } from '../protocol/types.ts';
import type { MissionCapability, MissionPlan, MissionPlanningSnapshot, ToyMissionPolicy, ToyRectangle } from '../planning/mission-types.ts';
import type { IrisClient } from '../integrations/iris/types.ts';
import type { Receipt } from '../integrations/receipts.ts';

export interface ExerciseObjective {
  readonly objective_id: string;
  readonly capture_goal: 'refresh_coverage';
  readonly required_capabilities: readonly MissionCapability[];
  readonly created_at_sim_tick: number;
}

/** Trusted, explicitly declared toy configuration. Not observations or physics. */
export interface ExerciseLayout {
  readonly approved_region: ToyRectangle;
  readonly sectors: MissionPlanningSnapshot['sectors'];
  readonly drones: readonly {
    readonly drone_id: string;
    readonly home: MissionPlanningSnapshot['drones'][number]['home'];
    readonly reserve_units: number;
    readonly link_available: boolean;
  }[];
  readonly blocked_areas: readonly ToyRectangle[];
  readonly policy: ToyMissionPolicy;
  readonly rights_manifests: Readonly<Record<string, string>>;
}

/** Server-owned reviewed exercise manifest, not a candidate registration API. */
export interface ReviewedExerciseCourse {
  readonly option_id: string;
  readonly course_fingerprint: string;
  readonly candidate_id: string;
}

export interface ExerciseCoordinatorConfig {
  readonly analyst: ActorContext;
  readonly layout: ExerciseLayout;
  readonly reviewed_courses: readonly ReviewedExerciseCourse[];
  readonly iris?: IrisClient;
}

export interface ExerciseAssessment {
  readonly contract_version: 'orchestration-demo.v1';
  readonly mode: 'EXERCISE';
  readonly verification_status: 'unverified';
  readonly assessment_id: string;
  readonly snapshot_id: string;
  readonly objective_id: string;
  readonly input_revision: number;
  readonly status: 'assessing' | 'review_ready' | 'review_only' | 'proposed' | 'approved' | 'superseded';
  readonly plan: MissionPlan;
  readonly selected_option_id: string | null;
  readonly registered_candidate_ids: readonly string[];
  readonly proposal_id: string | null;
  readonly command_id: string | null;
  readonly ranking: {
    readonly source: 'validated-ranking' | 'deterministic-fallback';
    readonly reason: string;
    readonly receipt: Receipt | null;
  };
  readonly evidence_ids: readonly string[];
  readonly reasons: readonly string[];
}

export interface ExerciseCoordinatorState {
  readonly mode: 'EXERCISE';
  readonly assessment_count: number;
  readonly in_flight: number;
  readonly assessments: readonly ExerciseAssessment[];
}
