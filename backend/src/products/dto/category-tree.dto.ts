export interface CategoryTreeNode {
  id: string;
  name: string;
  slug: string;
  /** Active products on this node plus active descendants. */
  productCount: number;
  children: CategoryTreeNode[];
}
