import { IsUUID } from 'class-validator';

export class ReplacePhotoDto {
  /** The id returned by POST /uploads for the new photo. */
  @IsUUID()
  uploadedFileId: string;
}
