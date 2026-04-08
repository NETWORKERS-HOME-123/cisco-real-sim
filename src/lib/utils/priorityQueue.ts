/**
 * Priority Queue Implementation (Min-Heap)
 * O(log n) insertion and extraction vs O(n log n) for array sort
 */

export class PriorityQueue<T> {
  private heap: T[] = [];
  private compare: (a: T, b: T) => number;

  constructor(compareFn: (a: T, b: T) => number) {
    this.compare = compareFn;
  }

  /**
   * Get the size of the queue
   */
  size(): number {
    return this.heap.length;
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  /**
   * Peek at the highest priority item without removing it
   */
  peek(): T | undefined {
    return this.heap[0];
  }

  /**
   * Add an item to the queue
   * Time complexity: O(log n)
   */
  enqueue(item: T): void {
    this.heap.push(item);
    this.heapifyUp(this.heap.length - 1);
  }

  /**
   * Remove and return the highest priority item
   * Time complexity: O(log n)
   */
  dequeue(): T | undefined {
    if (this.heap.length === 0) return undefined;
    if (this.heap.length === 1) return this.heap.pop();

    const result = this.heap[0];
    this.heap[0] = this.heap.pop()!;
    this.heapifyDown(0);
    return result;
  }

  /**
   * Clear all items from the queue
   */
  clear(): void {
    this.heap.length = 0;
  }

  /**
   * Get all items (for debugging/inspection)
   */
  toArray(): T[] {
    return [...this.heap];
  }

  /**
   * Heapify up from given index
   */
  private heapifyUp(index: number): void {
    let current = index;
    
    while (current > 0) {
      const parent = Math.floor((current - 1) / 2);
      
      if (this.compare(this.heap[current], this.heap[parent]) >= 0) {
        break;
      }
      
      this.swap(current, parent);
      current = parent;
    }
  }

  /**
   * Heapify down from given index
   */
  private heapifyDown(index: number): void {
    let current = index;
    
    while (true) {
      let smallest = current;
      const left = 2 * current + 1;
      const right = 2 * current + 2;

      if (left < this.heap.length && 
          this.compare(this.heap[left], this.heap[smallest]) < 0) {
        smallest = left;
      }

      if (right < this.heap.length && 
          this.compare(this.heap[right], this.heap[smallest]) < 0) {
        smallest = right;
      }

      if (smallest === current) break;

      this.swap(current, smallest);
      current = smallest;
    }
  }

  /**
   * Swap two elements in the heap
   */
  private swap(i: number, j: number): void {
    [this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]];
  }
}

/**
 * Binary Heap implementation for numeric priorities
 */
export class MinHeap<T> {
  private heap: { item: T; priority: number }[] = [];

  /**
   * Insert an item with given priority
   */
  insert(item: T, priority: number): void {
    this.heap.push({ item, priority });
    this.bubbleUp(this.heap.length - 1);
  }

  /**
   * Extract the item with minimum priority
   */
  extractMin(): T | undefined {
    if (this.heap.length === 0) return undefined;
    if (this.heap.length === 1) return this.heap.pop()!.item;

    const min = this.heap[0].item;
    this.heap[0] = this.heap.pop()!;
    this.bubbleDown(0);
    return min;
  }

  /**
   * Peek at the minimum item
   */
  peek(): T | undefined {
    return this.heap[0]?.item;
  }

  /**
   * Get size
   */
  size(): number {
    return this.heap.length;
  }

  /**
   * Check if empty
   */
  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  private bubbleUp(index: number): void {
    const element = this.heap[index];
    
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const parent = this.heap[parentIndex];
      
      if (element.priority >= parent.priority) break;
      
      this.heap[index] = parent;
      index = parentIndex;
    }
    
    this.heap[index] = element;
  }

  private bubbleDown(index: number): void {
    const length = this.heap.length;
    const element = this.heap[index];

    while (true) {
      let swapIndex = null;
      const leftChildIndex = 2 * index + 1;
      const rightChildIndex = 2 * index + 2;

      if (leftChildIndex < length) {
        if (this.heap[leftChildIndex].priority < element.priority) {
          swapIndex = leftChildIndex;
        }
      }

      if (rightChildIndex < length) {
        if (
          (swapIndex === null && this.heap[rightChildIndex].priority < element.priority) ||
          (swapIndex !== null && this.heap[rightChildIndex].priority < this.heap[leftChildIndex].priority)
        ) {
          swapIndex = rightChildIndex;
        }
      }

      if (swapIndex === null) break;

      this.heap[index] = this.heap[swapIndex];
      index = swapIndex;
    }

    this.heap[index] = element;
  }
}
