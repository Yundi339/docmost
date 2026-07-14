import { ConflictException, NotFoundException } from '@nestjs/common';
import { TemplateService } from './template.service';

describe('TemplateService.useTemplate', () => {
  const template = {
    id: 'template_1',
    title: 'Template',
    content: {},
    icon: null,
  };
  const parentPage = {
    id: 'parent_1',
    spaceId: 'space_1',
    workspaceId: 'workspace_1',
    deletedAt: null,
  };

  function createService() {
    const templateRepo = {
      findById: jest.fn().mockResolvedValue(template),
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
    return {
      pageOperationPolicy,
      pageRepo,
      service: new TemplateService(
        templateRepo as never,
        pageRepo as never,
        spaceMemberRepo as never,
        pageOperationPolicy as never,
      ),
    };
  }

  it('validates the parent and applies page extension policy', async () => {
    const { pageOperationPolicy, pageRepo, service } = createService();

    await service.useTemplate(
      {
        templateId: template.id,
        spaceId: parentPage.spaceId,
        parentPageId: parentPage.id,
      },
      'user_1',
      parentPage.workspaceId,
    );

    expect(pageOperationPolicy.assertOperation).toHaveBeenCalledWith({
      operation: 'createChild',
      parentPage,
      actorId: 'user_1',
    });
    expect(pageRepo.insertPage).toHaveBeenCalled();
  });

  it('rejects a parent from another space or workspace', async () => {
    const { pageRepo, service } = createService();
    pageRepo.findById.mockResolvedValue({
      ...parentPage,
      spaceId: 'other_space',
    });

    await expect(
      service.useTemplate(
        {
          templateId: template.id,
          spaceId: parentPage.spaceId,
          parentPageId: parentPage.id,
        },
        'user_1',
        parentPage.workspaceId,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

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
        'user_1',
        parentPage.workspaceId,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(pageRepo.insertPage).not.toHaveBeenCalled();
  });
});
