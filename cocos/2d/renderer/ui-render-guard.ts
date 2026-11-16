/** Runtime guards for the JavaScript UI rendering path (including mini games). */
import { warn } from '../../core';

const warnings = new Map<string, { time: number; count: number }>();

/** Limit by reason, not component ID, so a damaged screen cannot flood the console. */
export function warnUIRender (reason: string, details: Record<string, unknown>): void {
    const now = Date.now();
    const previous = warnings.get(reason);
    if (previous && now - previous.time < 5000) {
        ++previous.count;
        return;
    }
    warn('[UI_RENDER_GUARD]', reason, { ...details, suppressed: previous ? previous.count : 0 });
    warnings.set(reason, { time: now, count: 0 });
}
