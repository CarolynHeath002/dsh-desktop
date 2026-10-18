/** Launcher-owned profile locations and composition inputs. */
import { join } from 'node:path'
import { composeEntries, loadProfileDirectory, PROFILE_PATCH_FILENAME, type Profile } from './profile.ts'
import { loadOptionalPatches } from './index.ts'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'

/** Application-owned package manager executable; environment applies only to package operations. */
export interface ProfilePnpmInvocation {
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
}

/** Current profile facts; scheduling and mutation belong to their callers. */
export interface ProfileContext {
  readonly name: string
  /** Packaged applications supply their bundled runtime instead of a PATH executable. */
  readonly packageManager?: ProfilePnpmInvocation
  readonly dir: string
  readonly patchPath: string
  readonly installAnchor: string
  readonly cwd: string
  readonly home: string
  /** Bundle packages used to start this process, before any persisted edits. */
  readonly startedBundles: readonly string[]
  /** Parsed command-line overlays, applied above profile and home patches. */
  readonly overlays: readonly PatchOptions[]
  /** Launch-time DSH_TELEMETRY_DISABLED value; any non-empty value opts out. */
  readonly telemetryDisabledEnv: string | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Present only in a profile launched by dsh. */
    profileContext: ProfileContext
  }
}

const TELEMETRY_ROW_ID = 'session-telemetry-otel'

/**
 * Egress rows this repository force-disables at the final composition layer,
 * keyed by the bundle that declares them. When that bundle mounts, all of its
 * rows must compose together: an upstream split, rename, or move surfaces as a
 * missing id and fails loud instead of leaving the moved row enabled. Profiles
 * that do not mount the bundle skip the group, so test fixtures with synthetic
 * bundles and custom compositions without these bundles are unaffected.
 */
const PRIVACY_HARDENING_ROW_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  '@deepseek-ai/dsh-base': ['session-log-deepseek', 'session-telemetry-otel', 'web-search-deepseek', 'web-deepseek-api'],
  '@deepseek-ai/dsh-web-app': ['desktop-product-telemetry', 'product-analytics', 'ui-settings-web-search'],
}

/**
 * Resolve the privacy-hardening disables for the composed rows. Each present
 * hardened row of a mounted bundle becomes a final `disabled: true` patch;
 * rows of unmounted bundles export nothing and need no patch. A mounted
 * bundle whose hardened rows do not all compose throws: the bundle changed
 * and the list above must be reviewed before the launch continues, because
 * layers below this one cannot be trusted to keep the egress row off.
 * @param presentIds - row ids present after every bundle, profile, home, and overlay layer.
 * @param startedBundles - bundle packages the launcher mounted for this profile.
 * @returns one disable patch per present hardened row, in group declaration order.
 */
export function resolvePrivacyHardeningPatches(
  presentIds: ReadonlySet<string>, startedBundles: readonly string[],
): PatchOptions[] {
  const patches: PatchOptions[] = []
  for (const [bundle, rowIds] of Object.entries(PRIVACY_HARDENING_ROW_FAMILIES)) {
    if (!startedBundles.includes(bundle)) continue
    const missing = rowIds.filter(id => !presentIds.has(id))
    if (missing.length > 0) {
      throw new Error(`privacy hardening is stale for the ${bundle} rows: missing [${missing.join(', ')}]; `
        + 'update PRIVACY_HARDENING_ROW_FAMILIES in packages/boot/app-boot/src/profile-context.ts')
    }
    patches.push(...rowIds.map(id => ({ id, disabled: true })))
  }
  return patches
}

/**
 * Resolve the telemetry opt-out switch into its boot patch. ANY non-empty
 * value (including `'0'`/`'false'`) disables: a privacy switch prefers
 * off-by-mistake over on-by-mistake. A composition without the telemetry row
 * exports nothing, so the switch is then trivially satisfied and no patch is
 * generated — custom profiles need not mount telemetry to run with the
 * switch set.
 * @param disabledEnv - the raw `DSH_TELEMETRY_DISABLED` value (`undefined` when unset).
 * @param hasRow - whether the composition carries the telemetry row.
 * @returns the disable patch, or `undefined` when no hard-disable patch is required.
 */
export function resolveTelemetryPatch(disabledEnv: string | undefined, hasRow: boolean): PatchOptions | undefined {
  if ((disabledEnv ?? '') === '' || !hasRow) return undefined
  return { id: TELEMETRY_ROW_ID, disabled: true }
}

/** Read the selected bundles' patches, which apply before the profile patch file.
 * @param binName Diagnostic prefix for malformed or missing configuration.
 * @param context Data supplied by the profile launcher.
 * @param initialProfile Already loaded startup profile; omitted reads the current files.
 * @returns Bundle patches in application order.
 */
export function readBundlePatches(binName: string, context: ProfileContext, initialProfile?: Profile): PatchOptions[] {
  const profile = initialProfile ?? loadProfileDirectory(binName, context.dir, context.installAnchor, { userLayer: false })
  return profile.layers.flatMap(layer => layer.patches)
}

/** Read current bundle and user layers with the launch-time overlays.
 * @param binName Diagnostic prefix for malformed or missing configuration.
 * @param context Data supplied by the profile launcher.
 * @param initialProfile Already loaded startup profile; omitted reads the current files.
 * @returns Detached ordered patches; this function does not update the Loader.
 */
export function readProfilePatches(binName: string, context: ProfileContext, initialProfile?: Profile): PatchOptions[] {
  const patches = structuredClone([
    ...readBundlePatches(binName, context, initialProfile),
    ...(initialProfile?.patches ?? loadOptionalPatches(binName, context.patchPath) ?? []),
    ...(loadOptionalPatches(binName, join(context.home, PROFILE_PATCH_FILENAME)) ?? []),
    ...context.overlays,
  ])
  const composed = composeEntries([patches])
  const telemetryPatch = resolveTelemetryPatch(context.telemetryDisabledEnv,
    composed.some(row => row.id === TELEMETRY_ROW_ID))
  if (telemetryPatch !== undefined) patches.push(telemetryPatch)
  patches.push(...resolvePrivacyHardeningPatches(new Set(composed.map(row => row.id)), context.startedBundles))
  return patches
}
