import { isPlainObject, mapValues, reduce } from "lodash";

export function objectKeys<T extends object>(object: T): Array<keyof T> {
	return Object.keys(object) as Array<keyof T>;
}

export function objectEntries<T extends object>(
	object: T
): Array<[keyof T, T[keyof T]]> {
	return Object.entries(object) as Array<[keyof T, T[keyof T]]>;
}

type Flattened<T> = { [K: string]: any };

/**
 * Flattens the inner keys of an object while maintaining the top-level hierarchy.
 *
 * @param obj - The object to be flattened.
 * @returns A new object with top-level keys preserved and inner keys flattened.
 */
export function flattenObjectToFirstLevel<T extends object>(
	obj: T
): Flattened<T> {
	const flatten = (prefix: string, obj: any): Flattened<T> => {
		return reduce(
			obj,
			(acc, value, key) => {
				const newKey = prefix ? `${prefix}.${key}` : key;
				if (isPlainObject(value)) {
					return { ...acc, ...flatten(newKey, value) };
				}
				return { ...acc, [newKey]: value };
			},
			{} as Flattened<T>
		);
	};

	return mapValues(obj, (value) => {
		if (isPlainObject(value)) {
			return flatten("", value);
		}
		return value;
	});
}
