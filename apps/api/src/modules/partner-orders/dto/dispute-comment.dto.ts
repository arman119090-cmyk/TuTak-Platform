import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUrl, Length } from 'class-validator';

/** Evidence and comments (spec §29). */
export class DisputeCommentDto {
  @IsString()
  @Length(1, 4000)
  body: string;

  @IsArray()
  @ArrayMaxSize(10)
  @IsUrl({}, { each: true })
  @IsOptional()
  attachmentUrls?: string[];
}
