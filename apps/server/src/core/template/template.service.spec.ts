import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TemplateService } from './template.service';

describe('TemplateService authorization', () => {
  const user = { id: 'user_1', role: 'member' } as any;
  const workspace = {
    id: 'workspace_1',
    settings: { templates: { allowMemberTemplates: true } },
  } as any;
  const template = {
    id: 'template_1',
    title: 'Template',
    content: {},
    icon: null,
    spaceId: null,
    workspaceId: workspace.id,
  };
  const parentPage = {
    id: 'parent_1',
    spaceId: 'space_1',
    workspaceId: workspace.id,
    deletedAt: null,
  };

  function createQuery(result: unknown) {
    const query: any = {
      select: jest.fn(() => query),
      where: jest.fn(() => query),
      executeTakeFirst: jest.fn().mockResolvedValue(result),
      execute: jest.fn().mockResolvedValue(result),
    };
    return query;
  }

  function createService(options?: {
    template?: Record<string, unknown>;
    workspaceAdmin?: boolean;
    spaceCanRead?: boolean;
    spaceCanEdit?: boolean;
    spaceExists?: boolean;
  }) {
    const selectedTemplate = { ...template, ...options?.template };
    const templateRepo = {
      findById: jest.fn().mockResolvedValue(selectedTemplate),
      findTemplates: jest.fn(),
      insertTemplate: jest.fn().mockResolvedValue({ id: template.id }),
      updateTemplate: jest.fn(),
      deleteTemplate: jest.fn(),
    };
    const pageRepo = {
      findById: jest.fn().mockResolvedValue(parentPage),
      insertPage: jest.fn().mockImplementation(async (input) => ({
        ...input,
        id: 'page_1',
      })),
    };
    const spaceMemberRepo = {
      getUserSpaceIds: jest.fn().mockResolvedValue(['space_1']),
    };
    const pageOperationPolicy = {
      assertOperation: jest.fn().mockResolvedValue(undefined),
    };
    const pageAccessService = {
      validateCanEdit: jest.fn().mockResolvedValue(undefined),
    };
    const workspaceAbility = {
      createForUser: jest.fn().mockReturnValue({
        can: jest.fn().mockReturnValue(options?.workspaceAdmin ?? false),
      }),
    };
    const spaceAbility = {
      createForUser: jest.fn().mockResolvedValue({
        cannot: jest.fn((action: string) =>
          action === 'read'
            ? !(options?.spaceCanRead ?? true)
            : !(options?.spaceCanEdit ?? true),
        ),
      }),
    };
    const db = {
      selectFrom: jest.fn(() =>
        createQuery(
          options?.spaceExists === false ? undefined : { id: 'space_1' },
        ),
      ),
    };

    return {
      db,
      pageAccessService,
      pageOperationPolicy,
      pageRepo,
      spaceAbility,
      templateRepo,
      service: new TemplateService(
        templateRepo as never,
        pageRepo as never,
        spaceMemberRepo as never,
        pageOperationPolicy as never,
        pageAccessService as never,
        workspaceAbility as never,
        spaceAbility as never,
        db as never,
      ),
    };
  }

  it('hides a space template from users who cannot read its space', async () => {
    const { service } = createService({
      template: { spaceId: 'private_space' },
      spaceCanRead: false,
    });

    await expect(
      service.findById(template.id, user, workspace),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires target space edit and parent page edit before use', async () => {
    const { pageAccessService, pageOperationPolicy, pageRepo, service } =
      createService();

    await service.useTemplate(
      {
        templateId: template.id,
        spaceId: parentPage.spaceId,
        parentPageId: parentPage.id,
      },
      user,
      workspace,
    );

    expect(pageAccessService.validateCanEdit).toHaveBeenCalledWith(
      parentPage,
      user,
    );
    expect(pageOperationPolicy.assertOperation).toHaveBeenCalledWith({
      operation: 'createChild',
      parentPage,
      actorId: user.id,
    });
    expect(pageRepo.insertPage).toHaveBeenCalled();
  });

  it('does not create a page when the target space is read-only', async () => {
    const { pageRepo, service } = createService({ spaceCanEdit: false });

    await expect(
      service.useTemplate(
        { templateId: template.id, spaceId: parentPage.spaceId },
        user,
        workspace,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(pageRepo.insertPage).not.toHaveBeenCalled();
  });

  it('does not write when parent page permission rejects child creation', async () => {
    const { pageAccessService, pageRepo, service } = createService();
    pageAccessService.validateCanEdit.mockRejectedValue(
      new ForbiddenException(),
    );

    await expect(
      service.useTemplate(
        {
          templateId: template.id,
          spaceId: parentPage.spaceId,
          parentPageId: parentPage.id,
        },
        user,
        workspace,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(pageRepo.insertPage).not.toHaveBeenCalled();
  });

  it('does not write when an extension rejects child creation', async () => {
    const { pageOperationPolicy, pageRepo, service } = createService();
    pageOperationPolicy.assertOperation.mockRejectedValue(
      new ConflictException('Create work items from the board'),
    );

    await expect(
      service.useTemplate(
        {
          templateId: template.id,
          spaceId: parentPage.spaceId,
          parentPageId: parentPage.id,
        },
        user,
        workspace,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(pageRepo.insertPage).not.toHaveBeenCalled();
  });

  it('blocks member template creation when the workspace setting is off', async () => {
    const { service, templateRepo } = createService();
    const disabledWorkspace = { ...workspace, settings: {} };

    await expect(
      service.create(
        { title: 'Denied', spaceId: 'space_1' },
        user,
        disabledWorkspace,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(templateRepo.insertTemplate).not.toHaveBeenCalled();
  });

  it('blocks members from managing workspace-wide templates', async () => {
    const { service, templateRepo } = createService();

    await expect(
      service.delete(template.id, user, workspace),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(templateRepo.deleteTemplate).not.toHaveBeenCalled();
  });

  it('allows workspace admins to manage workspace-wide templates', async () => {
    const { service, templateRepo } = createService({ workspaceAdmin: true });

    await service.delete(template.id, user, workspace);
    expect(templateRepo.deleteTemplate).toHaveBeenCalledWith(
      template.id,
      workspace.id,
    );
  });
});
