/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 * Originally derived from celiums-memory v2.0
 * (https://github.com/terrizoaguimor/celiums-memory, Apache 2.0)
 */
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Celiums Solutions LLC

/**
 * Metering module — implements ADR-008.
 */

export type {
  UsageCategory, UnitKind, WindowKind,
  MeterRecordInput, UsageEvent, UsageCounterRow,
} from './types.js';
export {
  DEFAULT_CATEGORIES, CATEGORY_UNIT_KIND, MeterInvalidInput,
} from './types.js';

export {
  USAGE_SCHEMA_SQL,
  createMonthlyPartitionSql,
  dropMonthlyPartitionSql,
  rollingPartitions,
} from './schema.js';

export { Meter, type MeterOptions } from './meter.js';

export {
  getTenantUsage, getPlatformUsage, queryUsageEvents,
  type GetUsageOptions,
} from './queries.js';

export {
  buildPayload, signPayload, fireUsageWebhook,
  type WebhookPayload, type FireWebhookOptions,
} from './webhook.js';

export {
  exportMonthForArchive, dropArchivedPartition,
  pruneShortWindowCounters, pruneMonthCounters,
} from './retention.js';
