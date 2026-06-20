import { IsJSON, IsString, IsUUID, MaxLength } from 'class-validator';
import { COMMENT_CONTENT_MAX_LENGTH } from './create-comment.dto';

export class UpdateCommentDto {
  @IsUUID()
  commentId: string;

  @IsString()
  @IsJSON()
  @MaxLength(COMMENT_CONTENT_MAX_LENGTH)
  content: string;
}
