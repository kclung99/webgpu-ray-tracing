import { surroundingAABB } from "./aabb.js";

function boxCompare(a, b, axis) {
    // compare w/ bbox min on given axis
    return a.bbox.min[axis] - b.bbox.min[axis];
}

function sortRange(items, start, end, compareFn) {
    const sorted = items.slice(start, end).sort(compareFn);
    items.splice(start, end - start, ...sorted); // ??
}

function aabbLongestAxis(box) {
    const dx = box.max[0] - box.min[0];
    const dy = box.max[1] - box.min[1];
    const dz = box.max[2] - box.min[2];

    if (dx > dy) {
        return dx > dz ? 0 : 2;
    }

    return dy > dz ? 1 : 2;
}

function spanAABB(items, start, end) {
    let box = items[start].bbox;

    for (let i = start + 1; i < end; i++) {
        box = surroundingAABB(box, items[i].bbox);
    }

    return box;
}

export function buildBVH(spheres) {
    // keep original sphere index
    const items = spheres.map((sphere, index) => ({
        sphere,
        sphereIndex: index,
        bbox: sphere.bbox,
    }))

    const nodes = [];
    const rootIndex = buildBVHRange(items, 0, items.length, nodes);

    return {
        nodes,
        rootIndex,
    };
}

function buildBVHRange(items, start, end, nodes) {
    // keep index for curr created node, pre-order allocation
    const nodeIndex = nodes.length;
    nodes.push(null);

    // build bbox for the entire span first
    const objectSpan = end - start;
    const bbox = spanAABB(items, start, end);

    // leaf node
    if (objectSpan === 1) {
        const item = items[start];
        nodes[nodeIndex] = {
            bbox: item.bbox,
            leftIndex: -1,
            leftIndex: -1,
            sphereIndex: item.sphereIndex,
            sphereCount: 1,
        }
        return nodeIndex;
    }

    // internal node (sort and split along the widest axis)
    const axis = aabbLongestAxis(bbox);

    sortRange(items, start, end, (a, b) => {
        return boxCompare(a, b, axis);
    });

    const mid = start + Math.floor(objectSpan / 2);

    const leftIndex = buildBVHRange(items, start, mid, nodes);
    const rightIndex = buildBVHRange(items, mid, end, nodes);

    const left = nodes[leftIndex];
    const right = nodes[rightIndex];

    nodes[nodeIndex] = {
        bbox: surroundingAABB(left.bbox, right.bbox),
        leftIndex,
        rightIndex,
        sphereIndex: -1,
        sphereCount: 0,
    };

    return nodeIndex;
}