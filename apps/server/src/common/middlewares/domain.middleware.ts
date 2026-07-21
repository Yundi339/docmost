import { Injectable, NestMiddleware } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';

@Injectable()
export class DomainMiddleware implements NestMiddleware {
  constructor(
    private workspaceRepo: WorkspaceRepo,
    private environmentService: EnvironmentService,
  ) {}
  async use(
    req: FastifyRequest['raw'],
    res: FastifyReply['raw'],
    next: () => void,
  ) {
    if (this.environmentService.isSelfHosted()) {
      const workspace = await this.workspaceRepo.findActiveFirst();
      if (!workspace) {
        setWorkspaceContext(req, null);
        return next();
      }

      setWorkspaceContext(req, workspace);
    } else if (this.environmentService.isCloud()) {
      const host = getRequestHost(req);
      const subdomain = host?.split('.')[0];

      const workspace = subdomain
        ? await this.workspaceRepo.findActiveByHostname(subdomain)
        : null;

      if (!workspace) {
        setWorkspaceContext(req, null);
        return next();
      }

      setWorkspaceContext(req, workspace);
    }

    next();
  }
}

function setWorkspaceContext(req: unknown, workspace: any | null) {
  const request = req as any;
  const raw = request.raw ?? request;
  const workspaceId = workspace?.id ?? null;

  request.workspaceId = workspaceId;
  request.workspace = workspace ?? undefined;

  raw.workspaceId = workspaceId;
  raw.workspace = workspace ?? undefined;
}

function getRequestHost(req: FastifyRequest['raw']) {
  const forwardedHost = getFirstHeaderValue(req.headers['x-forwarded-host']);
  const host = forwardedHost || getFirstHeaderValue(req.headers.host);
  return host?.split(':')[0]?.trim().toLowerCase();
}

function getFirstHeaderValue(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(',')[0]?.trim();
}
