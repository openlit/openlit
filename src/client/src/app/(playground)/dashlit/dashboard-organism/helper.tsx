export function convertLayoutToMolecules(layout: any) {
  return layout.map((item: any) => {
    return {
      id: item.i,
    };
  });
}
