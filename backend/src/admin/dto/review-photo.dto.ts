import {
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export const PHOTO_REVIEW_DECISIONS = ['APPROVE', 'REQUEST_CHANGES'] as const;
export type PhotoReviewDecision = (typeof PHOTO_REVIEW_DECISIONS)[number];

export class ReviewPhotoDto {
  @IsIn(PHOTO_REVIEW_DECISIONS)
  decision: PhotoReviewDecision;

  /** Shown to the customer. Required when asking for a new photo. */
  @ValidateIf((o: ReviewPhotoDto) => o.decision === 'REQUEST_CHANGES')
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  note?: string;
}
