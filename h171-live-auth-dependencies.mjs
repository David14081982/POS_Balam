// Current LIVE cleanup contract. The pinned historical retirement keeps its
// original 18-FK catalog; only the reviewed LIVE preflight/adapter use this list.
import { AUTH_INCOMING_FKS } from './h171-auth-retirement.mjs';

const additions = [
  { relation: 'auth.mfa_recovery_code_sets', column: 'user_id', effect: 'c' },
  { relation: 'auth.scim_users', column: 'user_id', effect: 'n' },
].map(Object.freeze);

export const LIVE_AUTH_INCOMING_FKS = Object.freeze([...AUTH_INCOMING_FKS, ...additions]);
// These QA journeys never provision MFA recovery sets or SCIM identities.
// Neither an unexpected cascade nor SET NULL is authorized by the QA user FK.
export const LIVE_AUTH_QA_EMPTY_RELATIONS = Object.freeze(additions.map(f => f.relation));
