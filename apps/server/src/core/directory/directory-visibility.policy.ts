import { Injectable } from '@nestjs/common';
import { UserRole } from '../../common/helpers/types/permission';
import {
  DirectoryContext,
  DirectoryScope,
  DirectoryVisibility,
} from './directory.types';

const PAGE_AWARE_CONTEXTS = new Set<DirectoryContext>([
  'mention',
  'verification',
]);

const SPACE_AWARE_CONTEXTS = new Set<DirectoryContext>([
  'permission-picker',
  'database-person',
]);

@Injectable()
export class DirectoryVisibilityPolicy {
  resolveVisibility(settings: unknown): DirectoryVisibility {
    const value = (settings as any)?.directory?.visibility;
    if (
      value === 'workspace' ||
      value === 'context' ||
      value === 'admins-only'
    ) {
      return value;
    }
    return 'workspace';
  }

  resolveScope(
    visibility: DirectoryVisibility,
    role: string | null | undefined,
    context: DirectoryContext,
  ): DirectoryScope {
    if (PAGE_AWARE_CONTEXTS.has(context)) {
      return 'target-page';
    }

    if (role === UserRole.OWNER || role === UserRole.ADMIN) {
      return 'workspace';
    }

    if (visibility === 'workspace') {
      return 'workspace';
    }

    if (visibility === 'context' && SPACE_AWARE_CONTEXTS.has(context)) {
      return 'target-space';
    }

    if (context === 'space-member' || SPACE_AWARE_CONTEXTS.has(context)) {
      return 'exact';
    }

    return 'self';
  }
}
