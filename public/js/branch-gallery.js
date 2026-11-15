(function () {
  function slidesFor(listing) {
    const galleries = listing.branchGalleries || [];
    const selected = galleries.findIndex(branch => branch.branchNumber === listing.branchNumber);
    const ordered = selected > 0 ? [...galleries.slice(selected), ...galleries.slice(0, selected)] : galleries;
    return ordered.flatMap(branch => branch.photos.map((photo, index) => ({
      url: photo.url,
      caption: photo.outdoor || index === 0 ? `Branch ${branch.branchNumber} · ${photo.label}` : photo.label
    })));
  }
  window.DormBranchGallery = { slidesFor };
}());
