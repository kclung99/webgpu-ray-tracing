import { vec3 } from "./vec3.js";

const MAT_LAMBERTIAN = 0;
const MAT_METAL = 1;
const MAT_DIELECTRIC = 2;

function randomDouble(min = 0, max = 1) {
    return min + (max - min) * Math.random();
}

export function createFinalScene() {
    const materials = [];
    const spheres = [];

    function addMaterial(material) {
        const index = materials.length;
        materials.push(material);
        return index;
    }

    function addStationarySphere(center, radius, materialIndex) {
        spheres.push({
            center0: center,
            center1: center,
            radius,
            materialIndex,
        });
    }

    function addMovingSphere(center0, center1, radius, materialIndex) {
        spheres.push({
            center0,
            center1,
            radius,
            materialIndex,
        });
    }

    // ground
    const groundMat = addMaterial({
        kind: MAT_LAMBERTIAN,
        fuzz: 0.0,
        refractionIndex: 0.0,
        albedo: vec3.fromValues(0.5, 0.5, 0.5),
    });

    addStationarySphere(vec3.fromValues(0, -1000, 0), 1000, groundMat);

    // many small spheres
    for (let a = -11; a < 11; a++) {
        for (let b = -11; b < 11; b++) {
            const chooseMat = Math.random();

            const center = vec3.fromValues(
                a + 0.9 * Math.random(),
                0.2,
                b + 0.9 * Math.random(),
            );

            const bigSphereCenter = vec3.fromValues(4, 0.2, 0);
            const offset = vec3.create();
            vec3.sub(offset, center, bigSphereCenter);

            const awayFromBigSphere = vec3.length(offset) > 0.9;
            if (!awayFromBigSphere) continue;

            let materialIndex;

            if (chooseMat < 0.8) {
                // diffuse
                const albedo = vec3.create();
                vec3.mul(albedo, vec3.random(), vec3.random());

                materialIndex = addMaterial({
                    kind: MAT_LAMBERTIAN,
                    fuzz: 0.0,
                    refractionIndex: 0.0,
                    albedo,
                });

                const center2 = vec3.fromValues(
                    center[0],
                    center[1] + randomDouble(0.0, 0.5),
                    center[2],
                );

                addMovingSphere(center, center2, 0.2, materialIndex);
            } else if (chooseMat < 0.95) {
                // metal
                const albedo = vec3.random(0.5, 1.0);
                const fuzz = randomDouble(0.0, 0.5);

                materialIndex = addMaterial({
                    kind: MAT_METAL,
                    fuzz,
                    refractionIndex: 0.0,
                    albedo,
                });

                addStationarySphere(center, 0.2, materialIndex);
            } else {
                // glass
                materialIndex = addMaterial({
                    kind: MAT_DIELECTRIC,
                    fuzz: 0.0,
                    refractionIndex: 1.5,
                    albedo: vec3.fromValues(1.0, 1.0, 1.0),
                });

                addStationarySphere(center, 0.2, materialIndex);
            }
        }
    }

    // three big spheres
    const material1 = addMaterial({
        kind: MAT_DIELECTRIC,
        fuzz: 0.0,
        refractionIndex: 1.5,
        albedo: vec3.fromValues(1.0, 1.0, 1.0),
    });

    addStationarySphere(vec3.fromValues(0, 1, 0), 1.0, material1);

    const material2 = addMaterial({
        kind: MAT_LAMBERTIAN,
        fuzz: 0.0,
        refractionIndex: 0.0,
        albedo: vec3.fromValues(0.4, 0.2, 0.1),
    });

    addStationarySphere(vec3.fromValues(-4, 1, 0), 1.0, material2);

    const material3 = addMaterial({
        kind: MAT_METAL,
        fuzz: 0.0,
        refractionIndex: 0.0,
        albedo: vec3.fromValues(0.7, 0.6, 0.5),
    });

    addStationarySphere(vec3.fromValues(4, 1, 0), 1.0, material3);

    return { materials, spheres };
}