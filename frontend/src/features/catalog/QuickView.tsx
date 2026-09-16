import { useEffect, useState } from 'react';
import { useProduct } from '@/hooks/useProduct';
import { ProductImage } from '@/features/catalog/ProductImage';
import { VariantSelector } from '@/features/cart/VariantSelector';
import { CustomizationForm, type CustomizationFormState } from '@/features/customization/CustomizationForm';
import { AddToCartControls } from '@/features/cart/AddToCartControls';
import { StarRating } from '@/features/reviews/StarRating';
import { Skeleton } from '@/components/ui/Skeleton';
import { Alert } from '@/components/ui/Alert';
import { getApiErrorMessage } from '@/utils/apiError';
import { formatPrice } from '@/utils/formatPrice';
import { Modal } from '@/components/ui/Modal';
import { optimizedCloudinaryUrl } from '@/features/media/mediaAsset';
import styles from './QuickView.module.css';

const EMPTY_CUSTOMIZATION_STATE: CustomizationFormState = {
  values: [],
  surcharge: 0,
  isValid: true,
};

interface QuickViewProps {
  slug: string;
  onClose: () => void;
}

export function QuickView({ slug, onClose }: QuickViewProps) {
  const { data: product, isPending, isError, error } = useProduct(slug);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [customization, setCustomization] = useState<CustomizationFormState>(EMPTY_CUSTOMIZATION_STATE);

  // close on slug change (should not happen) or external
  useEffect(() => onClose, [onClose]);

  const handleCustomizationChange = (state: CustomizationFormState) => setCustomization(state);

  if (isPending) {
    return (
      <Modal isOpen={true} onClose={onClose} title="Quick View" size="lg">
        <div className={styles.skeleton}>
          <Skeleton className={styles.imageSkeleton} />
          <div className={styles.infoSkeleton}>
            <Skeleton className={styles.titleSkeleton} />
            <Skeleton className={styles.priceSkeleton} />
          </div>
        </div>
      </Modal>
    );
  }

  if (isError) {
    return (
      <Modal isOpen={true} onClose={onClose} title="Quick View" size="lg">
        <Alert variant="error">{getApiErrorMessage(error)}</Alert>
      </Modal>
    );
  }

  if (!product) return null;

  const selectedVariant = product.variants.find((v) => v.id === selectedVariantId);
  const total = Number(product.basePrice) + Number(selectedVariant?.priceDelta ?? 0) + customization.surcharge;

  // Determine if drawer on mobile via CSS (Modal handles responsive)
  return (
    <Modal isOpen={true} onClose={onClose} title={product.name} size="lg">
      <div className={styles.grid}>
        <div className={styles.gallery}>
          <ProductImage key={product.id} images={product.images} label={product.name} />
          {product.images.length > 1 && (
            <div className={styles.thumbnails} role="list" aria-label="Product images">
              {product.images.map((img, idx) => (
                <button
                  key={img.id}
                  className={styles.thumb}
                  onClick={() => {/* could swap main image later */}}
                  aria-label={`View image ${idx + 1}`}
                  role="listitem"
                >
                  <img src={optimizedCloudinaryUrl(img.url, 200)} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={styles.info}>
          <StarRating avgRating={product.avgRating} reviewCount={product.reviewCount} />
          <p className={styles.price}>{formatPrice(total)}</p>

          {product.specifications && Object.keys(product.specifications).length > 0 && (
            <dl className={styles.specs}>
              {Object.entries(product.specifications).map(([key, value]) => (
                <div key={key} className={styles.specRow}>
                  <dt>{key}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
            </dl>
          )}

          {product.variants.length > 0 && (
            <VariantSelector
              variants={product.variants}
              selectedVariantId={selectedVariantId}
              onChange={setSelectedVariantId}
            />
          )}

          <CustomizationForm
            fields={product.customizationFields}
            onChange={handleCustomizationChange}
          />

          <AddToCartControls
            product={product}
            selectedVariantId={selectedVariantId}
            customization={customization}
          />
        </div>
      </div>
    </Modal>
  );
}