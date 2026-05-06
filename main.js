import { vec3 } from "./vec3.js";
import { createFinalScene } from "./scene.js"

async function main() {
    const adapter = await navigator.gpu?.requestAdapter();
    const device = await adapter?.requestDevice();
    if (!device) {
        console.error("no web gpu instance")
        return;
    }

    // config canvas context
    const aspectRatio = 16.0 / 9.0;
    const imageWidth = 1200;
    const imageHeight = Math.max(1, Math.floor(imageWidth / aspectRatio));

    const canvas = document.querySelector("canvas");
    canvas.width = imageWidth; // render resolution, not canvas css height
    canvas.height = imageHeight;

    const progressEl = document.querySelector("#progress");

    const context = canvas.getContext("webgpu");
    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device,
        format: presentationFormat
    })

    const vsModule = device.createShaderModule({
        code: /* wgsl */ `
        @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
            var pos = array<vec2f, 3>(
                vec2f(-1.0, -1.0),
                vec2f(3.0, -1.0),
                vec2f(-1.0, 3.0),
            );

            return vec4f(pos[i], 0, 1.0);
        }
        `
    })

    const fsCode = await fetch("./fs.wgsl").then((res) => res.text());
    const fsModule = device.createShaderModule({
        code: fsCode
    });

    const displayFsModule = device.createShaderModule({
        code: /* wgsl */ `
        @group(0) @binding(0)
        var accumTex: texture_2d<f32>;

        @fragment
        fn fs(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
            let pixel = vec2u(fragCoord.xy);
            let color = textureLoad(accumTex, pixel, 0).rgb;

            // gamma correction
            let corrected = sqrt(max(color, vec3f(0.0)));

            return vec4f(corrected, 1.0);
        }
        `
    })

    // camera
    const vfov = 20; // angle
    const lookFrom = vec3.fromValues(13, 2, 3);
    const lookAt = vec3.fromValues(0, 0, 0)
    const vup = vec3.fromValues(0, 1, 0);

    const theta = vfov * Math.PI / 180; // vfov in radians

    const viewDir = vec3.create();
    vec3.sub(viewDir, lookFrom, lookAt);
    const focalLength = vec3.length(viewDir);

    const w = vec3.create(); // backward
    vec3.normalize(w, viewDir);

    const u = vec3.create(); // right
    vec3.cross(u, vup, w);
    vec3.normalize(u, u);

    const v = vec3.create(); // up
    vec3.cross(v, w, u);

    const cameraData = new Float32Array(20);

    function writeCamera() {
        cameraData[0] = canvas.width;
        cameraData[1] = canvas.height;
        cameraData[2] = Math.tan(theta / 2);
        cameraData[3] = focalLength;

        cameraData.set(lookFrom, 4); // position
        cameraData[7] = 0;

        cameraData.set(u, 8);
        cameraData[11] = 0;

        cameraData.set(v, 12);
        cameraData[15] = 0;

        cameraData.set(w, 16);
        cameraData[19] = 0;
    }

    writeCamera();

    const cameraBuffer = device.createBuffer({
        size: cameraData.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(cameraBuffer, 0, cameraData);

    const { materials, spheres, bvh } = createFinalScene();

    // sphere
    const SLOTS_PER_SPHERE = 8;
    const BYTES_PER_SPHERE = SLOTS_PER_SPHERE * 4; // 32 bit each

    const SPHERE_OFFSET_CENTER0 = 0; // 0, 1, 2
    const SPHERE_OFFSET_RADIUS = 3;
    const SPHERE_OFFSET_CENTER1 = 4; // 4, 5, 6
    const SPHERE_OFFSET_MATERIAL_INDEX = 7;

    // material
    const SLOTS_PER_MATERIAL = 8;
    const BYTES_PER_MATERIAL = SLOTS_PER_MATERIAL * 4;

    const MAT_OFFSET_KIND = 0;
    const MAT_OFFSET_FUZZ = 1;
    const MAT_OFFSET_REFRACTION_INDEX = 2;

    const MAT_OFFSET_ALBEDO = 4;

    // bvh node
    const SLOTS_PER_BVH_NODE = 12;
    const BYTES_PER_BVH_NODE = SLOTS_PER_BVH_NODE * 4;

    const BVH_OFFSET_BBOX_MIN = 0; // 0, 1, 2
    const BVH_OFFSET_LEFT_INDEX = 3;

    const BVH_OFFSET_BBOX_MAX = 4; // 4, 5, 6
    const BVH_OFFSET_RIGHT_INDEX = 7;

    const BVH_OFFSET_SPHERE_INDEX = 8;
    const BVH_OFFSET_SPHERE_COUNT = 9;


    // sphere buffer
    const sphereBufferData = new ArrayBuffer(spheres.length * BYTES_PER_SPHERE); // raw bytes
    const sphereF32 = new Float32Array(sphereBufferData);
    const sphereU32 = new Uint32Array(sphereBufferData);

    function writeSphere(i, sphere) {
        const base = i * SLOTS_PER_SPHERE;

        sphereF32.set(sphere.center0, base + SPHERE_OFFSET_CENTER0);
        sphereF32[base + SPHERE_OFFSET_RADIUS] = sphere.radius;

        sphereF32.set(sphere.center1, base + SPHERE_OFFSET_CENTER1);
        sphereU32[base + SPHERE_OFFSET_MATERIAL_INDEX] = sphere.materialIndex;
    }

    for (let i = 0; i < spheres.length; i++) {
        writeSphere(i, spheres[i]);
    }

    const sphereBuffer = device.createBuffer({
        size: sphereBufferData.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(sphereBuffer, 0, sphereBufferData);

    // material buffer
    const materialBufferData = new ArrayBuffer(materials.length * BYTES_PER_MATERIAL);
    const materialF32 = new Float32Array(materialBufferData);
    const materialU32 = new Uint32Array(materialBufferData);

    function writematerial(i, material) {
        const base = i * SLOTS_PER_MATERIAL;

        materialU32[base + MAT_OFFSET_KIND] = material.kind;
        materialF32[base + MAT_OFFSET_FUZZ] = material.fuzz;
        materialF32[base + MAT_OFFSET_REFRACTION_INDEX] = material.refractionIndex;
        materialU32[base + 3] = 0;

        materialF32.set(material.albedo, base + MAT_OFFSET_ALBEDO);
        materialU32[base + 7] = 0;
    }

    for (let i = 0; i < materials.length; i++) {
        writematerial(i, materials[i]);
    }

    const materialBuffer = device.createBuffer({
        size: materialBufferData.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(materialBuffer, 0, materialBufferData);

    // bvh buffer
    const bvhBufferData = new ArrayBuffer(bvh.nodes.length * BYTES_PER_BVH_NODE);
    const bvhF32 = new Float32Array(bvhBufferData);
    const bvhI32 = new Int32Array(bvhBufferData);
    const bvhU32 = new Uint32Array(bvhBufferData);

    function writeBVHNode(i, node) {
        const base = i * SLOTS_PER_BVH_NODE;

        bvhF32.set(node.bbox.min, base + BVH_OFFSET_BBOX_MIN);
        bvhI32[base + BVH_OFFSET_LEFT_INDEX] = node.leftIndex;

        bvhF32.set(node.bbox.max, base + BVH_OFFSET_BBOX_MAX);
        bvhI32[base + BVH_OFFSET_RIGHT_INDEX] = node.rightIndex;

        bvhI32[base + BVH_OFFSET_SPHERE_INDEX] = node.sphereIndex;
        bvhU32[base + BVH_OFFSET_SPHERE_COUNT] = node.sphereCount;

        bvhU32[base + 10] = 0;
        bvhU32[base + 11] = 0;
    }

    for (let i = 0; i < bvh.nodes.length; i++) {
        writeBVHNode(i, bvh.nodes[i]);
    }

    const bvhBuffer = device.createBuffer({
        size: bvhBufferData.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    device.queue.writeBuffer(bvhBuffer, 0, bvhBufferData);

    // render params
    const paramsData = new Uint32Array(4);
    const paramsBuffer = device.createBuffer({
        size: paramsData.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    // accum texture
    function createAccumTexture() {
        return device.createTexture({
            size: [canvas.width, canvas.height],
            format: "rgba16float",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
    }

    const accumTextures = [
        createAccumTexture(),
        createAccumTexture()
    ]

    // pipeline
    const pipeline = device.createRenderPipeline({
        layout: 'auto', // inferred from WGSL
        vertex: {
            module: vsModule
        },
        fragment: {
            module: fsModule,
            targets: [{ format: "rgba16float" }]
        }
    })

    const displayPipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: {
            module: vsModule
        },
        fragment: {
            module: displayFsModule,
            targets: [{ format: presentationFormat }]
        }
    })

    function createRayBindGroup(oldAccumView) {
        return device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: { buffer: cameraBuffer }
                },
                {
                    binding: 1,
                    resource: { buffer: sphereBuffer }
                },
                {
                    binding: 2,
                    resource: { buffer: materialBuffer }
                },
                {
                    binding: 3,
                    resource: { buffer: paramsBuffer }
                },
                {
                    binding: 4,
                    resource: oldAccumView
                },
                {
                    binding: 5,
                    resource: { buffer: bvhBuffer }
                },
            ]
        });
    }

    function createDisplayBindGroup(textureView) {
        return device.createBindGroup({
            layout: displayPipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: textureView
                }
            ]
        })
    }

    const renderPassDescriptor = {
        colorAttachments: [
            {
                clearValue: [0.3, 0.3, 0.3, 1],
                loadOp: 'clear',
                storeOp: 'store'
            }
        ]
    }

    function render() {
        paramsData[0] = frameIndex;
        paramsData[1] = samplesPerFrame;
        paramsData[2] = bvh.rootIndex;
        paramsData[3] = bvh.nodes.length;

        device.queue.writeBuffer(paramsBuffer, 0, paramsData);

        const readIndex = frameIndex % 2;
        const writeIndex = 1 - readIndex;

        const readView = accumTextures[readIndex].createView();
        const writeView = accumTextures[writeIndex].createView();

        const rayBindGroup = createRayBindGroup(readView);

        const encoder = device.createCommandEncoder();

        // pass 1: ray trace into accum texture
        {
            const pass = encoder.beginRenderPass({
                colorAttachments: [
                    {
                        view: writeView,
                        clearValue: [0.0, 0.0, 0.0, 1.0],
                        loadOp: 'clear',
                        storeOp: 'store'
                    }
                ]
            });

            pass.setPipeline(pipeline);
            pass.setBindGroup(0, rayBindGroup);
            pass.draw(3);
            pass.end();
        }

        // pass 2: disply accum texture
        {
            const displayBindGroup = createDisplayBindGroup(writeView);

            const pass = encoder.beginRenderPass({
                colorAttachments: [
                    {
                        view: context.getCurrentTexture().createView(),
                        clearValue: [0.0, 0.0, 0.0, 1.0],
                        loadOp: 'clear',
                        storeOp: 'store'
                    }
                ]
            });

            pass.setPipeline(displayPipeline);
            pass.setBindGroup(0, displayBindGroup);
            pass.draw(3);
            pass.end();
        }

        const commandBuffer = encoder.finish();
        device.queue.submit([commandBuffer]);
    }

    // const observer = new ResizeObserver(entries => {
    //     for (const entry of entries) {
    //         const canvas = entry.target;
    //         const width = entry.contentBoxSize[0].inlineSize;
    //         const height = entry.contentBoxSize[0].blockSize;
    //         canvas.width = Math.max(1, Math.min(width, device.limits.maxTextureDimension2D));
    //         canvas.height = Math.max(1, Math.min(height, device.limits.maxTextureDimension2D));
    //     }
    //     render();
    // });

    // observer.observe(canvas);

    let frameIndex = 0;
    const maxSamples = 100;
    const samplesPerFrame = 1;

    function frame() {
        if (frameIndex >= maxSamples) {
            progressEl.textContent = `samples: ${maxSamples} / ${maxSamples}`;
            return;
        }

        render();
        frameIndex++;
        progressEl.textContent = `samples: ${frameIndex} / ${maxSamples}`;
        requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
}

main();