/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 * Originally derived from celiums-memory v2.0
 * (https://github.com/terrizoaguimor/celiums-memory, Apache 2.0)
 */
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Celiums Solutions LLC

/**
 * RBAC module — implements ADR-010.
 */

export type {
  CanonicalRole, Capability,
} from './types.js';
export {
  ROLE_PRECEDENCE, strongerRole, isPlatformCapability, RbacDenied,
} from './types.js';

export {
  CAPABILITY_MATRIX, hasCapability, capabilitiesFor,
} from './capabilities.js';

export {
  resolveRole, PgMembershipLoader, NO_MEMBERSHIPS,
  type MembershipLoader, type ResolverOptions,
} from './resolver.js';

export {
  requireCapability, checkCapability, makeSecurityAuditHook,
  type CapabilityCheckOptions, type PlatformCapabilityAuditEvent,
} from './check.js';

export { legacyToCanonical, canonicalToLegacy } from './adapter.js';
