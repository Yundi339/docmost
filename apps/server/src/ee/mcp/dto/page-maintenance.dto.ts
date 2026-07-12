import { Equals, IsBoolean } from 'class-validator';
import { PageIdDto } from '../../../core/page/dto/page.dto';

export class TrashPageToolDto extends PageIdDto {
  @IsBoolean()
  @Equals(true, { message: 'confirm must be true' })
  confirm: boolean;
}
